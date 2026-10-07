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

// editFilter is the ffmpeg filter graph that plays each piece at its speed
// and joins them, out at outputFPS: input [0:v], output [out].
func editFilter(segs []segment) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[0:v]split=%d", len(segs))
	for i := range segs {
		fmt.Fprintf(&b, "[s%d]", i)
	}
	b.WriteString(";")
	for i, s := range segs {
		fmt.Fprintf(&b, "[s%d]trim=start=%.4f:end=%.4f,setpts=(PTS-STARTPTS)/%g[v%d];", i, s.From, s.To, s.Speed, i)
	}
	for i := range segs {
		fmt.Fprintf(&b, "[v%d]", i)
	}
	fmt.Fprintf(&b, "concat=n=%d:v=1:a=0,fps=%d,format=yuv420p[out]", len(segs), outputFPS)
	return b.String()
}

// editArgs are ffmpeg's arguments to turn a numbered frame sequence captured
// at `captureFPS` into the finished MP4. The encoder is libx264 unless
// AT_ENCODER names another (h264_nvenc on a box where NVENC works).
func editArgs(frames string, captureFPS int, segs []segment, encoder, out string) []string {
	args := []string{"-y", "-hide_banner", "-loglevel", "error",
		"-framerate", fmt.Sprint(captureFPS), "-i", frames,
		"-filter_complex", editFilter(segs), "-map", "[out]",
		"-c:v", encoder}
	if encoder == "libx264" {
		args = append(args, "-preset", "slow", "-crf", "18")
	} else {
		args = append(args, "-cq", "19", "-preset", "p6")
	}
	return append(args, "-movflags", "+faststart", out)
}
