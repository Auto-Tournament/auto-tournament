package main

import (
	"fmt"
	"math"
	"strings"
)

// The highlight edit: the clip plays at full speed, then slows step by step
// (about a second of video) so that it reaches slowmoSpeed as the last enemy
// dies, holds there (about three seconds) and cuts.
const (
	slowmoSpeed = 0.5
	rampSec     = 0.75 // game seconds slowing down into the kill (≈1 s of video)
	holdSec     = 1.5  // game seconds at slowmoSpeed after that (3 s of video)
	rampSteps   = 8    // the slowing is this many constant-speed pieces
	outputFPS   = 120
	// tailSec is how much game after the last kill a clip shows.
	tailSec = holdSec
)

// segment is a piece of the recording (seconds from its start) played at one speed.
type segment struct {
	From, To, Speed float64
}

// speedRamp cuts a recording of `length` seconds into pieces: full speed,
// slowing so it is at slowmoSpeed at `kill` seconds in, then holding to the end.
func speedRamp(length, kill float64) []segment {
	var out []segment
	add := func(from, to, speed float64) {
		from, to = math.Max(0, from), math.Min(length, to)
		if to-from < 1e-6 {
			return
		}
		if n := len(out); n > 0 && out[n-1].Speed == speed && math.Abs(out[n-1].To-from) < 1e-6 {
			out[n-1].To = to
			return
		}
		out = append(out, segment{from, to, speed})
	}
	start := kill - rampSec
	add(0, start, 1)
	step := rampSec / rampSteps
	for i := 0; i < rampSteps; i++ {
		speed := math.Round((1+(slowmoSpeed-1)*float64(i+1)/rampSteps)*1000) / 1000
		add(start+float64(i)*step, start+float64(i+1)*step, speed)
	}
	add(kill, length, slowmoSpeed)
	return out
}

// outputSeconds is how long the edited clip runs.
func outputSeconds(segs []segment) float64 {
	total := 0.0
	for _, s := range segs {
		total += (s.To - s.From) / s.Speed
	}
	return total
}

// audioFilter plays the moment's sound [1:a] (from its start, `length`
// seconds) piece by piece at each piece's speed, the way a record slows down:
// the pitch drops with the speed and comes back with it. Output [a].
func audioFilter(segs []segment, length float64) string {
	var b strings.Builder
	n := len(segs)
	fmt.Fprintf(&b, "[1:a]atrim=duration=%.4f,asetpts=PTS-STARTPTS,aresample=48000,asplit=%d", length, n)
	for i := range segs {
		fmt.Fprintf(&b, "[t%d]", i)
	}
	b.WriteString(";")
	for i, s := range segs {
		fmt.Fprintf(&b, "[t%d]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS", i, s.From, s.To)
		if math.Abs(s.Speed-1) > 1e-6 {
			fmt.Fprintf(&b, ",asetrate=%d,aresample=48000", int(math.Round(48000*s.Speed)))
		}
		fmt.Fprintf(&b, "[a%d];", i)
	}
	for i := range segs {
		fmt.Fprintf(&b, "[a%d]", i)
	}
	fmt.Fprintf(&b, "concat=n=%d:v=0:a=1[a]", n)
	return b.String()
}

// captionSec is how long the caption (and the avatar) show at a clip's start.
const captionSec = 3.0

// overlay is what goes on top of a clip's frames ([0:v]).
type overlay struct {
	card   int // input holding the caption card (card.go), looped, or -1
	logo   int // input holding the Auto Tournament logo, looped, or -1
	width  int
	height int
}

// videoFilter dresses the frames: the caption card in the lower left for the
// first seconds, and the logo faintly in the lower right throughout (the
// top right is the kill feed's). Output [v].
func videoFilter(o overlay) string {
	margin := o.height / 18
	var b strings.Builder
	b.WriteString("[0:v]format=yuv420p[base]")
	last := "base"
	if o.card >= 0 {
		fmt.Fprintf(&b, ";[%d:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=%g:d=0.4:alpha=1[card]"+
			";[%s][card]overlay=%d:H-%d-h:eof_action=pass[withcard]", o.card, captionSec, last, margin, margin)
		last = "withcard"
	}
	if o.logo >= 0 {
		fmt.Fprintf(&b, ";[%d:v]scale=%d:-1,format=rgba,colorchannelmixer=aa=0.25[logo]"+
			";[%s][logo]overlay=W-w-%d:H-h-%d:shortest=1", o.logo, o.width*12/100, last, margin, margin)
	} else {
		fmt.Fprintf(&b, ";[%s]null", last)
	}
	b.WriteString(",format=yuv420p[v]")
	return b.String()
}

// encodeArgs are the output settings every piece and the reel share, so the
// pieces can be joined without re-encoding.
func encodeArgs(encoder string) []string {
	args := []string{"-c:v", encoder, "-r", fmt.Sprint(outputFPS)}
	if encoder == "libx264" {
		args = append(args, "-preset", "slow", "-crf", "18", "-profile:v", "high")
	} else {
		args = append(args, "-cq", "19", "-preset", "p6")
	}
	return append(args, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2")
}
