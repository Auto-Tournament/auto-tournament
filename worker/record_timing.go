package main

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

// tickrate is CS2's ticks per second of game time.
const tickrate = 64

// frameRef is one captured frame: which capture, which frame in it.
type frameRef struct {
	source, index int
	// next and weight: the wanted moment falls between frame index and frame
	// next (same source), weight of the way to it; next < 0 for one frame.
	// The capture gives about 1.5 frames per frame wanted (88 a game second
	// for 60, 173 for 120): picking the nearest stepped 1, 2, 1, 2 frames and
	// fast camera moves stuttered (a jump, 2026-10-08). Blending the two
	// frames either side by their distance resamples evenly.
	next   int
	weight float64
}

// blendEdge is how close to a frame the wanted moment must be to show that
// frame alone (a blend that close is no different, and costs a second read).
//
// Off (0.5: always the nearest frame): with the capture's frames evenly
// spaced (CS2 held under the stream's rate) picking is smooth, and blending
// frames a 26th of a second apart showed as ghosting (2026-10-09).
// AT_BLEND=1 turns it back on.
var blendEdge = func() float64 {
	if env("AT_BLEND", "") == "1" {
		return 0.12
	}
	return 0.5
}()

// maxGapTicks is how far from the wanted moment a frame may be before the
// clip has a hole there (5 ticks: 78 ms, a frame shown a little longer). At
// 2 a capture's short stall failed the moment, and the retry started CS2
// over (a minute and more).
const maxGapTicks = 5.0

// maxHoleTicks is the longest hole a clip keeps: the nearest frame is shown
// for it (24 ticks: 375 ms, a short hitch; 16 failed the EWC final's 16.2). A capture stall at the same
// moment of the demo comes back on every retry, so failing the clip over it
// only lost the clip (two 4Ks of the EWC final, 5.2 ticks, 2026-10-10).
const maxHoleTicks = 24.0

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
			if gap > maxGapTicks {
				// A hole in this capture: another capture of the same moment (a
				// slowed one) may have frames there. CS2 can hitch at the same
				// moment of a demo on every full-speed pass (the EWC final, tick
				// 73551, 16 ticks on each of six tries) and play it smoothly slowed.
				for cand := range sources {
					if cand == si {
						continue
					}
					if cc, g := nearest(cand, want); cc >= 0 && g < gap {
						si, c, gap = cand, cc, g
					}
				}
			}
			if c < 0 || gap > maxHoleTicks {
				return nil, fmt.Errorf("no frame near tick %.0f (nearest %.1f ticks away)", want, gap)
			}
			last[si] = c
			ref := frameRef{source: si, index: sorted[si][c].index, next: -1}
			// The frame on the other side of the wanted moment, and how far towards it.
			frames := sorted[si]
			a, b := c, c+1
			if frames[c].tick > want {
				a, b = c-1, c
			}
			if a >= 0 && b < len(frames) && a >= last[si]-1 {
				if span := frames[b].tick - frames[a].tick; span > 0 && span <= maxGapTicks {
					w := (want - frames[a].tick) / span
					if w > blendEdge && w < 1-blendEdge {
						ref = frameRef{source: si, index: frames[a].index, next: frames[b].index, weight: w}
					}
				}
			}
			out = append(out, ref)
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

// blendFrames mixes b into a (raw frames of the same size), weight w of b.
func blendFrames(a, b []byte, w float64) {
	wb := uint32(math.Round(w * 256))
	wa := 256 - wb
	for i := range a {
		a[i] = byte((uint32(a[i])*wa + uint32(b[i])*wb + 128) >> 8)
	}
}
