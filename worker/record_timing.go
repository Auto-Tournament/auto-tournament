package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
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
const blendEdge = 0.12

// maxGapTicks is how far from the wanted moment a frame may be before the
// clip has a hole there (5 ticks: 78 ms, a frame shown a little longer). At
// 2 a capture's short stall failed the moment, and the retry started CS2
// over (a minute and more).
const maxGapTicks = 5.0

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

// blendFrames mixes b into a (raw frames of the same size), weight w of b.
func blendFrames(a, b []byte, w float64) {
	wb := uint32(math.Round(w * 256))
	wa := 256 - wb
	for i := range a {
		a[i] = byte((uint32(a[i])*wa + uint32(b[i])*wb + 128) >> 8)
	}
}

// rePTS is a gstreamer buffer's pts in identity's last-message:
// "… (3110400 bytes, dts: none, pts: 0:00:02.019865458, duration: …".
var rePTS = regexp.MustCompile(`pts: (\d+):(\d{2}):(\d{2})\.(\d+)`)

// bufferPTS is a buffer's pts in seconds, or -1 without one.
func bufferPTS(line string) float64 {
	m := rePTS.FindStringSubmatch(line)
	if m == nil {
		return -1
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	sec, _ := strconv.Atoi(m[3])
	frac, _ := strconv.ParseFloat("0."+m[4], 64)
	return float64(h*3600+mi*60+sec) + frac
}

// ptsTimes puts each frame at its pts on the wall clock instead of when its
// log line arrived (which waits on the pipe and the scheduler): a line can
// only arrive after its frame, so the smallest arrival−pts is the offset.
// Without a pts for every frame, the arrival times as they are.
func ptsTimes(arrived []time.Time, pts []float64) []time.Time {
	out := append([]time.Time(nil), arrived...)
	if len(pts) != len(arrived) || len(pts) == 0 {
		return out
	}
	offset := math.Inf(1)
	for i, p := range pts {
		if p < 0 {
			return out
		}
		if o := float64(arrived[i].UnixNano())/1e9 - p; o < offset {
			offset = o
		}
	}
	for i, p := range pts {
		out[i] = time.Unix(0, int64((p+offset)*1e9))
	}
	return out
}

// dropRepeats marks a frame the stream sent again (the same picture as the
// one before it) as no frame (-1): timed as a new moment, a repeat held the
// picture one frame and the frames around it ran unevenly. It compares a
// spread of samples of each raw frame with the last kept one.
func dropRepeats(raw string, frameBytes int64, ticks []float64) (int, error) {
	f, err := os.Open(raw)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	const samples, sampleLen = 96, 32
	read := func(i int, buf []byte) error {
		step := (frameBytes * 2 / 3) / samples // the luma plane: brightness changes with any movement
		for s := 0; s < samples; s++ {
			if _, err := f.ReadAt(buf[s*sampleLen:(s+1)*sampleLen], int64(i)*frameBytes+int64(s)*step); err != nil {
				return err
			}
		}
		return nil
	}
	prev := make([]byte, samples*sampleLen)
	cur := make([]byte, samples*sampleLen)
	dropped, have := 0, false
	for i := range ticks {
		if err := read(i, cur); err != nil {
			break
		}
		if have && ticks[i] >= 0 && string(cur) == string(prev) {
			ticks[i] = -1
			dropped++
			continue
		}
		prev, cur = cur, prev
		have = true
	}
	return dropped, nil
}
