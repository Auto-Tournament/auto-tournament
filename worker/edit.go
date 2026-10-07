package main

import (
	"fmt"
	"math"
	"strings"
)

// The highlight edit: the clip plays at full speed, slows down step by step
// into the last kill, holds there for a moment, and speeds back up.
const (
	slowmoSpeed   = 0.25 // at the kill
	rampInSec     = 0.6  // from full speed down to slowmoSpeed, ending on the kill
	holdSec       = 0.5  // at slowmoSpeed after it
	rampOutSec    = 0.4  // back to full speed
	rampSteps     = 6    // a ramp is this many constant-speed pieces
	outputFPS     = 120
	tickrateTicks = 64
)

// segment is a piece of the recording (seconds from its start) played at one speed.
type segment struct {
	From, To, Speed float64
}

// speedRamp cuts a recording of `length` seconds into pieces, with the slow
// motion landing on `kill` seconds in. A ramp that would start before the
// recording or end after it is clipped.
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
	lerp := func(a, b float64, i int) float64 {
		return math.Round((a+(b-a)*float64(i)/float64(rampSteps))*1000) / 1000
	}
	start := kill - rampInSec
	add(0, start, 1)
	for i := 0; i < rampSteps; i++ {
		step := rampInSec / rampSteps
		add(start+float64(i)*step, start+float64(i+1)*step, lerp(1, slowmoSpeed, i+1))
	}
	add(kill, kill+holdSec, slowmoSpeed)
	back := kill + holdSec
	for i := 0; i < rampSteps; i++ {
		step := rampOutSec / rampSteps
		add(back+float64(i)*step, back+float64(i+1)*step, lerp(slowmoSpeed, 1, i+1))
	}
	add(back+rampOutSec, length, 1)
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

// atempoChain slows or speeds audio by `speed` with atempo filters, each in
// atempo's 0.5..2 range (0.25 is atempo=0.5,atempo=0.5).
func atempoChain(speed float64) string {
	var parts []string
	for speed < 0.5-1e-9 {
		parts = append(parts, "atempo=0.5")
		speed /= 0.5
	}
	for speed > 2+1e-9 {
		parts = append(parts, "atempo=2")
		speed /= 2
	}
	if math.Abs(speed-1) > 1e-6 {
		parts = append(parts, fmt.Sprintf("atempo=%.4f", speed))
	}
	if len(parts) == 0 {
		return "anull"
	}
	return strings.Join(parts, ",")
}

// drawtextEscape makes a caption safe inside drawtext's text='...'.
func drawtextEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `'`, "’", `:`, `\:`, `%`, `\%`)
	return r.Replace(s)
}

// momentFilter plays one moment's video [0:v] and sound [1:a] piece by piece
// at each piece's speed (the slow motion), with `caption` in the lower left
// for its first seconds. Output [v] and [a].
func momentFilter(segs []segment, caption string) string {
	var b strings.Builder
	n := len(segs)
	fmt.Fprintf(&b, "[0:v]split=%d", n)
	for i := range segs {
		fmt.Fprintf(&b, "[s%d]", i)
	}
	fmt.Fprintf(&b, ";[1:a]asplit=%d", n)
	for i := range segs {
		fmt.Fprintf(&b, "[t%d]", i)
	}
	b.WriteString(";")
	for i, s := range segs {
		fmt.Fprintf(&b, "[s%d]trim=start=%.4f:end=%.4f,setpts=(PTS-STARTPTS)/%g[v%d];", i, s.From, s.To, s.Speed, i)
		fmt.Fprintf(&b, "[t%d]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS,%s[a%d];", i, s.From, s.To, atempoChain(s.Speed), i)
	}
	for i := range segs {
		fmt.Fprintf(&b, "[v%d][a%d]", i, i)
	}
	fmt.Fprintf(&b, "concat=n=%d:v=1:a=1[cv][ca];", n)
	b.WriteString("[cv]fps=" + fmt.Sprint(outputFPS) + ",format=yuv420p")
	if caption != "" {
		fmt.Fprintf(&b, ",drawtext=font='Sans':fontsize=h/26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=h/20:y=h-h/20-th:enable='lt(t,2.5)':text='%s'", drawtextEscape(caption))
	}
	b.WriteString("[v];[ca]aresample=48000[a]")
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
