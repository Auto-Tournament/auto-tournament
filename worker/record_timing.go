package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"sort"
	"time"
)

// tickrate is CS2's ticks per second of game time.
const tickrate = 64

// span is a stretch of demo played between a resume and a pause, at `scale`.
type span struct {
	fromTick, toTick int
	resumed, paused  time.Time
	scale            float64
}

// frameTicks is the tick each captured frame shows: the demo plays at a steady
// rate between its resume and its pause, so a frame's tick follows from when
// it arrived. Arrival times are noisy (the capture reports frames in bursts),
// so they are smoothed with a rolling straight-line fit over the frames around
// each one, and kept rising: frames are in the order CS2 drew them. Frames
// from before the resume or after the pause are -1.
// spanTicks is frameTicks over a pass of several spans (playPhases): each
// frame takes its tick from the span it arrived in.
func spanTicks(times []time.Time, spans []span) []float64 {
	out := make([]float64, len(times))
	for i := range out {
		out[i] = -1
	}
	for _, s := range spans {
		for i, v := range frameTicks(times, s) {
			if v >= 0 && out[i] < 0 {
				out[i] = v
			}
		}
	}
	return out
}

func frameTicks(times []time.Time, s span) []float64 {
	out := make([]float64, len(times))
	for i := range out {
		out[i] = -1
	}
	wall := s.paused.Sub(s.resumed).Seconds()
	if wall <= 0 {
		return out
	}
	perSecond := float64(s.toTick-s.fromTick) / wall
	var idx []int
	var raw []float64
	for i, t := range times {
		if t.Before(s.resumed) || t.After(s.paused) {
			continue
		}
		idx = append(idx, i)
		raw = append(raw, float64(s.fromTick)+t.Sub(s.resumed).Seconds()*perSecond)
	}
	smooth := rollingFit(raw, smoothFrames)
	prev := math.Inf(-1)
	for k, i := range idx {
		v := smooth[k]
		if v <= prev {
			v = prev + 1e-3
		}
		out[i], prev = v, v
	}
	return out
}

// smoothFrames is how many frames on each side the rolling fit uses.
const smoothFrames = 15

// rollingFit replaces each value by a least-squares line through the values
// within `half` places of it, evaluated at its own place.
func rollingFit(v []float64, half int) []float64 {
	out := make([]float64, len(v))
	for i := range v {
		lo, hi := i-half, i+half
		if lo < 0 {
			lo = 0
		}
		if hi > len(v)-1 {
			hi = len(v) - 1
		}
		n := float64(hi - lo + 1)
		var sx, sy, sxx, sxy float64
		for j := lo; j <= hi; j++ {
			x := float64(j)
			sx, sy, sxx, sxy = sx+x, sy+v[j], sxx+x*x, sxy+x*v[j]
		}
		den := n*sxx - sx*sx
		if den == 0 {
			out[i] = v[i]
			continue
		}
		slope := (n*sxy - sx*sy) / den
		out[i] = (sy-slope*sx)/n + slope*float64(i)
	}
	return out
}

// frameRef is one captured frame: which capture, which frame in it.
type frameRef struct {
	source, index int
}

// maxGapTicks is how far from the wanted moment a frame may be before the
// clip has a hole there (2 ticks: 31 ms).
const maxGapTicks = 2.0

// timeline is the clip's frames at outputFPS: the speed ramp `segs` (seconds
// from the clip's start at startTick) says which moment of the game each
// output frame shows. Full-speed pieces take their frames from the first
// capture (sources[0]); slowed pieces from a slowed capture (the others: the
// slowed opening, the slow motion at the end) that has them. Within a capture
// the frames never go back.
func timeline(sources [][]float64, segs []segment, startTick int) ([]frameRef, error) {
	type indexed struct {
		tick  float64
		index int
	}
	sorted := make([][]indexed, len(sources))
	for si, ticks := range sources {
		for i, t := range ticks {
			if t >= 0 {
				sorted[si] = append(sorted[si], indexed{t, i})
			}
		}
		sort.Slice(sorted[si], func(a, b int) bool { return sorted[si][a].index < sorted[si][b].index })
	}
	last := make([]int, len(sources)) // position in sorted[si] used last
	nearest := func(si int, want float64) (int, float64) {
		frames := sorted[si]
		k := sort.Search(len(frames), func(i int) bool { return frames[i].tick >= want })
		best, gap := -1, math.Inf(1)
		for _, c := range []int{k - 1, k} {
			if c >= last[si] && c >= 0 && c < len(frames) {
				if g := math.Abs(frames[c].tick - want); g < gap {
					best, gap = c, g
				}
			}
		}
		return best, gap
	}
	var out []frameRef
	for _, seg := range segs {
		n := int(math.Round((seg.To - seg.From) / seg.Speed * outputFPS))
		for j := 0; j < n; j++ {
			want := float64(startTick) + (seg.From+float64(j)*seg.Speed/outputFPS)*tickrate
			si := 0
			if seg.Speed < 1 {
				for cand := len(sources) - 1; cand > 0; cand-- {
					if _, gap := nearest(cand, want); gap <= maxGapTicks {
						si = cand
						break
					}
				}
			}
			c, gap := nearest(si, want)
			if c < 0 || gap > maxGapTicks {
				return nil, fmt.Errorf("no frame near tick %.0f (nearest %.1f ticks away)", want, gap)
			}
			last[si] = c
			out = append(out, frameRef{si, sorted[si][c].index})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("an empty clip")
	}
	return out, nil
}

// A moment's kills can be far apart (a 4K over 20 s): the clip then jumps from
// one stretch of kills to the next instead of showing the wait between them.
const (
	clusterGapTicks  = 4 * tickrate       // kills closer than this play as one stretch
	firstLeadTicks   = 3 * tickrate       // run-up before the first kill
	laterLeadTicks   = 3 * tickrate / 2   // run-up before a later stretch
	stretchTailTicks = tickrate * 12 / 10 // after a stretch that is not the last, before the cut to the next
)

// window is one stretch of a moment's clip, in the analyzer's ticks: the last
// one ends with the slow motion on its last kill (slowmo), the others play at
// full speed.
type window struct {
	from, to int
	slowmo   int // the last kill, for the last window; -1 otherwise
}

// planWindows splits a moment into stretches around its kills; `end` is where
// the last one stops (after the slow motion). Without kill ticks it is one
// stretch from `start`.
func planWindows(start, end, slowmo int, killTicks []int) []window {
	if len(killTicks) == 0 {
		return []window{{from: start, to: end, slowmo: slowmo}}
	}
	ticks := append([]int(nil), killTicks...)
	sort.Ints(ticks)
	var clusters [][]int
	for _, t := range ticks {
		if n := len(clusters); n > 0 && t-clusters[n-1][len(clusters[n-1])-1] <= clusterGapTicks {
			clusters[n-1] = append(clusters[n-1], t)
		} else {
			clusters = append(clusters, []int{t})
		}
	}
	var out []window
	for i, c := range clusters {
		w := window{from: c[0] - laterLeadTicks, to: c[len(c)-1] + stretchTailTicks, slowmo: -1}
		if i == 0 {
			w.from = c[0] - firstLeadTicks
		}
		if i == len(clusters)-1 {
			w.to, w.slowmo = end, slowmo
		}
		if w.from < 0 {
			w.from = 0
		}
		// Stretches that would overlap play as one.
		if n := len(out); n > 0 && w.from <= out[n-1].to {
			out[n-1].to, out[n-1].slowmo = w.to, w.slowmo
			continue
		}
		out = append(out, w)
	}
	return out
}

// seekLanded is whether a pause at `tick` means a seek to `target` landed:
// on or a little past it (it plays on for a moment before the pause).
func seekLanded(tick, target int) bool {
	return tick >= target-tickrate && tick <= target+8*tickrate
}

// slowBeforeSec is how far before the last kill the slowed capture starts.
const slowBeforeSec = 0.25

// captureSpeeds is how slowed the picture is played while it is captured.
// The capture takes what gamescope streams, about 30 frames a second
// whatever CS2 draws, so the demo plays slower: at main the full-speed parts
// get outputFPS frames per game second, at slow the slow motion (at
// slowmoSpeed) gets a real frame for every frame it shows, both with
// captureHeadroom to spare.
type captureSpeeds struct{ main, slow float64 }

// maxCaptureSpeed caps how much faster than real time the picture plays when
// the stream gives more frames than the clip needs (a small capture, a low
// output frame rate): CS2 still has to draw every tick it skips past.
const maxCaptureSpeed = 4.0

// captureHeadroom is the spare frames on top of what the clip shows.
const captureHeadroom = 1.15

// speedsFor is the capture speeds for a stream of `rate` frames a second.
func speedsFor(rate float64) captureSpeeds {
	scale := func(framesPerGameSecond float64) float64 {
		v := rate / (framesPerGameSecond * captureHeadroom)
		return math.Max(0.02, math.Min(maxCaptureSpeed, math.Floor(v*100)/100))
	}
	return captureSpeeds{main: scale(outputFPS), slow: scale(outputFPS / slowmoSpeed)}
}

// captureRate tracks the stream's frame rate from what each pass captured:
// a drop counts at once, a rise slowly.
type captureRate struct{ fps float64 }

func (c *captureRate) observe(fps float64) {
	if fps <= 0 {
		return
	}
	if fps < c.fps {
		c.fps = fps
	} else {
		c.fps = 0.7*c.fps + 0.3*fps
	}
}

// playPhase is one stretch of a pass: played up to analyzer tick `to` at
// `scale` (demo_timescale).
type playPhase struct {
	to    int
	scale float64
}

// picturePhases is one pass over a window: at sp.main, slowed to sp.slow
// for the opening under the caption card (introEnd > 0) and from slowFrom on
// (>= 0) for the slow motion. The lead before the window plays at sp.main.
func picturePhases(w window, introEnd, slowFrom int, sp captureSpeeds) []playPhase {
	var phases []playPhase
	add := func(to int, scale float64) {
		if n := len(phases); n > 0 && phases[n-1].scale == scale {
			phases[n-1].to = max(phases[n-1].to, to)
			return
		}
		if n := len(phases); n > 0 && to <= phases[n-1].to {
			return
		}
		phases = append(phases, playPhase{to, scale})
	}
	if introEnd > 0 {
		add(w.from-phaseMargin, sp.main)
		add(introEnd, sp.slow)
	}
	if slowFrom >= 0 {
		add(slowFrom-phaseMargin, sp.main)
		add(w.to, sp.slow)
	} else {
		add(w.to, sp.main)
	}
	return phases
}

// phaseMargin is how many ticks before a slowed stretch the speed changes:
// a pause lands a little after it is asked for.
const phaseMargin = 8

// wavSeconds is how long a WAV file's sound runs, from its fmt and data chunks.
func wavSeconds(path string) (float64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	if len(b) < 12 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0, errors.New("not a WAV file")
	}
	byteRate, data := 0, -1
	for i := 12; i+8 <= len(b); {
		id, size := string(b[i:i+4]), int(binary.LittleEndian.Uint32(b[i+4:]))
		body := i + 8
		switch id {
		case "fmt ":
			if body+12 <= len(b) {
				byteRate = int(binary.LittleEndian.Uint32(b[body+8:]))
			}
		case "data":
			// A file cut off before its header was finished says 0 or too much: count what is there.
			data = len(b) - body
			if size > 0 && size < data {
				data = size
			}
		}
		if id == "data" {
			break
		}
		i = body + size + size%2
	}
	if byteRate <= 0 || data < 0 {
		return 0, errors.New("no fmt or data chunk")
	}
	return float64(data) / float64(byteRate), nil
}
