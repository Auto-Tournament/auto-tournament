package main

import (
	"fmt"
	"math"
	"strings"
)

// The highlight edit: the clip plays at full speed, then slows step by step
// (about a second of video) so that it reaches slowmoSpeed as the last enemy
// dies, holds there (about a second and a half) and cuts.
const (
	slowmoSpeed = 0.25
	rampSec     = 0.6   // game seconds slowing down from the kill (≈1 s of video)
	holdSec     = 0.375 // game seconds at slowmoSpeed after that (1.5 s of video)
	rampSteps   = 8     // the slowing is this many constant-speed pieces
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

// drawtextEscape makes a caption safe inside drawtext's text='...'.
func drawtextEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `'`, "’", `:`, `\:`, `%`, `\%`)
	return r.Replace(s)
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

// videoFilter dresses the frames [0:v]: the caption lines in the lower left
// for the first seconds. Output [v].
func videoFilter(caption []string) string {
	f := "[0:v]format=yuv420p"
	for i, line := range caption {
		if line == "" {
			continue
		}
		size, weight := "h/34", ""
		if i == 0 {
			size = "h/24"
		}
		// Lines stack up from the bottom; the first (the player) on top.
		fromBottom := len(caption) - 1 - i
		f += fmt.Sprintf(",drawtext=font='Sans%s':fontsize=%s:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2:"+
			"x=h/18:y=h-h/18-th-%d*h/26:alpha='if(lt(t,0.3),t/0.3,if(lt(t,3),1,if(lt(t,3.4),(3.4-t)/0.4,0)))':text='%s'",
			weight, size, fromBottom, drawtextEscape(line))
	}
	return f + "[v]"
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
