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
// it arrived. Frames from before the resume or after the pause are -1.
func frameTicks(times []time.Time, s span) []float64 {
	out := make([]float64, len(times))
	wall := s.paused.Sub(s.resumed).Seconds()
	if wall <= 0 {
		for i := range out {
			out[i] = -1
		}
		return out
	}
	perSecond := float64(s.toTick-s.fromTick) / wall
	for i, t := range times {
		if t.Before(s.resumed) || t.After(s.paused) {
			out[i] = -1
			continue
		}
		out[i] = float64(s.fromTick) + t.Sub(s.resumed).Seconds()*perSecond
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
// output frame shows, and the captured frame nearest that moment, from any
// capture, is used. Slow parts so take their frames from the slowed capture.
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
		sort.Slice(sorted[si], func(a, b int) bool { return sorted[si][a].tick < sorted[si][b].tick })
	}
	var out []frameRef
	for _, seg := range segs {
		n := int(math.Round((seg.To - seg.From) / seg.Speed * outputFPS))
		for j := 0; j < n; j++ {
			want := float64(startTick) + (seg.From+float64(j)*seg.Speed/outputFPS)*tickrate
			best, bestGap := frameRef{-1, -1}, math.Inf(1)
			for si, frames := range sorted {
				k := sort.Search(len(frames), func(i int) bool { return frames[i].tick >= want })
				for _, c := range []int{k - 1, k} {
					if c >= 0 && c < len(frames) {
						if gap := math.Abs(frames[c].tick - want); gap < bestGap {
							best, bestGap = frameRef{si, frames[c].index}, gap
						}
					}
				}
			}
			if bestGap > maxGapTicks {
				return nil, fmt.Errorf("no frame near tick %.0f (nearest %.1f ticks away)", want, bestGap)
			}
			out = append(out, best)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("an empty clip")
	}
	return out, nil
}
