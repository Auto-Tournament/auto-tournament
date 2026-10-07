package main

import (
	"errors"
	"fmt"
	"math"
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
// capture (sources[0]); slowed pieces from the last (the slowed capture) where
// it has them. Within a capture the frames never go back.
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
			if seg.Speed < 1 && len(sources) > 1 {
				if _, gap := nearest(len(sources)-1, want); gap <= maxGapTicks {
					si = len(sources) - 1
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
