package main

import (
	"fmt"
	"math"
	"strings"
)

// The highlight edit: the clip plays at full speed until the last enemy dies,
// then slows step by step to slowmoSpeed (about a second of video), holds
// there (about two seconds), speeds back up the same way it slowed, plays on
// at full speed for a moment and cuts.
const (
	slowmoSpeed = 0.5
	rampSec     = 0.75 // game seconds slowing down from the kill, and speeding up again (≈1 s of video each)
	holdSec     = 1.0  // game seconds at slowmoSpeed in between (2 s of video)
	outroSec    = 0.5  // game seconds at full speed before the cut
	rampSteps   = 8    // a ramp is this many constant-speed pieces
	outputFPS   = 120
	// tailSec is how much game after the last kill a clip shows.
	tailSec = rampSec + holdSec + rampSec + outroSec
)

// segment is a piece of the recording (seconds from its start) played at one speed.
type segment struct {
	From, To, Speed float64
}

// speedRamp cuts a recording of `length` seconds into pieces: full speed to
// `kill` seconds in, slowing to slowmoSpeed, holding, back up to full speed,
// and full speed for the last outroSec.
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
	// The slowing steps, and the same steps in reverse to speed up again, so
	// both take as long.
	stepSpeed := func(i int) float64 {
		return math.Round((1+(slowmoSpeed-1)*float64(i+1)/rampSteps)*1000) / 1000
	}
	step := rampSec / rampSteps
	add(0, kill, 1)
	for i := 0; i < rampSteps; i++ {
		add(kill+float64(i)*step, kill+float64(i+1)*step, stepSpeed(i))
	}
	outro := math.Max(kill+rampSec, length-outroSec)
	upFrom := math.Max(kill+rampSec, outro-rampSec)
	add(kill+rampSec, upFrom, slowmoSpeed)
	upStep := (outro - upFrom) / rampSteps
	for i := 0; i < rampSteps; i++ {
		add(upFrom+float64(i)*upStep, upFrom+float64(i+1)*upStep, stepSpeed(rampSteps-1-i))
	}
	add(outro, length, 1)
	return out
}

// outputAt is where `t` seconds of the recording land in the edited clip.
func outputAt(segs []segment, t float64) float64 {
	total := 0.0
	for _, s := range segs {
		if t <= s.From {
			break
		}
		total += (math.Min(t, s.To) - s.From) / s.Speed
	}
	return total
}

// clipMarkers is where a clip's kills and slow motion are, in seconds of the
// video: the site's player marks them on its scrubber.
type clipMarkers struct {
	Duration float64     `json:"duration"`
	Kills    []float64   `json:"kills"`
	Slowmo   *[2]float64 `json:"slowmo"`
}

// momentMarkers works out a moment's markers from its windows (in order) and
// each window's edit.
func momentMarkers(windows []window, segs [][]segment, killTicks []int) clipMarkers {
	m := clipMarkers{Kills: []float64{}}
	round := func(v float64) float64 { return math.Round(v*100) / 100 }
	offset := 0.0
	for i, w := range windows {
		for _, k := range killTicks {
			if k >= w.from && k <= w.to {
				m.Kills = append(m.Kills, round(offset+outputAt(segs[i], float64(k-w.from)/tickrate)))
			}
		}
		first, last := -1, -1
		for j, s := range segs[i] {
			if s.Speed < 1 {
				if first < 0 {
					first = j
				}
				last = j
			}
		}
		if first >= 0 {
			m.Slowmo = &[2]float64{
				round(offset + outputAt(segs[i], segs[i][first].From)),
				round(offset + outputAt(segs[i], segs[i][last].To)),
			}
		}
		offset += outputSeconds(segs[i])
	}
	m.Duration = round(offset)
	return m
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
