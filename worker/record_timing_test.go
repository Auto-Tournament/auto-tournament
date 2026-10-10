package main

import (
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestFrameTicksFollowTheSpan(t *testing.T) {
	t0 := time.Unix(1000, 0)
	s := span{fromTick: 100, toTick: 164, resumed: t0, paused: t0.Add(5 * time.Second), scale: 0.2}
	ticks := frameTicks([]time.Time{t0.Add(-time.Second), t0.Add(2500 * time.Millisecond), t0.Add(6 * time.Second)}, s)
	if ticks[0] != -1 || ticks[2] != -1 || ticks[1] != 132 {
		t.Fatalf("got %v", ticks)
	}
}

func TestTimelinePrefersTheSlowCapture(t *testing.T) {
	// The main capture has a frame every ~0.5 tick (128/s); the slow one, around
	// tick 100-110, a frame every 0.1 tick.
	var main, slow []float64
	for tk := 0.0; tk <= 200; tk += 0.5 {
		main = append(main, tk)
	}
	for tk := 100.0; tk <= 110; tk += 0.1 {
		slow = append(slow, tk)
	}
	// Full speed to tick 102 (96 frames at 60 fps), then a quarter speed over
	// ticks 102-104 (8 frames).
	segs := []segment{{0, 102.0 / 64, 1}, {102.0 / 64, 104.0 / 64, 0.25}}
	frames, err := timeline([][]float64{main, slow}, segs, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(frames); got != 96+8 {
		t.Fatalf("%d frames", got)
	}
	usedSlow := 0
	for _, f := range frames[96:] {
		if f.source == 1 {
			usedSlow++
		}
	}
	if usedSlow < 6 {
		t.Fatalf("slow part used the slow capture for only %d of 8 frames", usedSlow)
	}
}

func TestTimelineRefusesAHole(t *testing.T) {
	if _, err := timeline([][]float64{{0, 1, 2}}, []segment{{0, 1, 1}}, 0); err == nil {
		t.Fatal("a second of game from three frames should fail")
	}
}

func TestTimelineHoldsAShortStall(t *testing.T) {
	// A frame every tick, then a 12-tick stall (6 from the nearest frame, over
	// maxGapTicks): the frame next to it is shown longer instead of the clip
	// failing.
	var ticks []float64
	for k := 0; k <= 64; k++ {
		if k > 30 && k < 43 {
			continue
		}
		ticks = append(ticks, float64(k))
	}
	frames, err := timeline([][]float64{ticks}, []segment{{0, 1, 1}}, 0)
	if err != nil || len(frames) == 0 {
		t.Fatalf("a short stall failed the clip: %v", err)
	}
}

func TestFrameTicksSmoothBursts(t *testing.T) {
	// Frames drawn every 40 ms but reported in bursts of four.
	t0 := time.Unix(1000, 0)
	var times []time.Time
	for i := 0; i < 200; i++ {
		times = append(times, t0.Add(time.Duration(i/4*4)*40*time.Millisecond))
	}
	s := span{fromTick: 0, toTick: 512, resumed: t0, paused: t0.Add(8 * time.Second)}
	ticks := frameTicks(times, s)
	for i := 20; i < 180; i++ {
		if ticks[i] <= ticks[i-1] {
			t.Fatalf("tick goes back at %d: %v %v", i, ticks[i-1], ticks[i])
		}
		// 40 ms of wall is 2.56 ticks; smoothed steps stay near that.
		if step := ticks[i] - ticks[i-1]; step < 1.5 || step > 3.5 {
			t.Fatalf("step %v at %d", step, i)
		}
	}
}

func TestPlanWindowsJumpsBetweenKillsFarApart(t *testing.T) {
	// d1Ledez's round-1 4K: 5316, then 6022, then 6612 and 6627.
	w := planWindows(5124, 6627+144, 6627, []int{5316, 6022, 6612, 6627})
	if len(w) != 3 {
		t.Fatalf("want three stretches, got %+v", w)
	}
	if w[0].from != 5316-firstLeadTicks || w[0].slowmo != -1 || w[1].from != 6022-laterLeadTicks {
		t.Fatalf("got %+v", w)
	}
	last := w[2]
	if last.from != 6612-laterLeadTicks || last.to != 6627+144 || last.slowmo != 6627 {
		t.Fatalf("last stretch %+v", last)
	}
}

func TestPlanWindowsKeepsCloseKillsTogether(t *testing.T) {
	w := planWindows(14699, 15100, 14999, []int{14891, 14951, 14986, 14999})
	if len(w) != 1 || w[0].from != 14891-firstLeadTicks || w[0].to != 15100 || w[0].slowmo != 14999 {
		t.Fatalf("got %+v", w)
	}
}

func TestPlanWindowsWithoutKills(t *testing.T) {
	w := planWindows(100, 900, 700, nil)
	if len(w) != 1 || w[0].from != 100 || w[0].to != 900 || w[0].slowmo != 700 {
		t.Fatalf("got %+v", w)
	}
}

func TestSeekLanded(t *testing.T) {
	for _, c := range []struct {
		tick, target int
		want         bool
	}{
		{5000, 5000, true},
		{5100, 5000, true},
		{5000 - tickrate, 5000, true},
		{0, 5000, false}, // still at the start: the seek has not landed
		{5000 + 20*tickrate, 5000, false},
	} {
		if got := seekLanded(c.tick, c.target); got != c.want {
			t.Errorf("seekLanded(%d, %d) = %v, want %v", c.tick, c.target, got, c.want)
		}
	}
}

func TestPicturePhases(t *testing.T) {
	w := window{from: 1000, to: 1400, slowmo: 1300}
	sp := captureSpeeds{main: 0.2, slow: 0.1}
	// Opening slowed, full speed, slow motion to the end.
	got := picturePhases(w, 1100, 1284, sp)
	want := []playPhase{{1000 - phaseMargin, sp.main}, {1100, sp.slow}, {1284 - phaseMargin, sp.main}, {1400, sp.slow}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	// The slow motion starts inside the opening: one slowed stretch.
	if got := picturePhases(w, 1300, 1284, sp); !reflect.DeepEqual(got, []playPhase{{1000 - phaseMargin, sp.main}, {1400, sp.slow}}) {
		t.Fatalf("overlapping: %v", got)
	}
	// A later piece, no slow motion: one phase at full speed.
	if got := picturePhases(window{from: 1000, to: 1400, slowmo: -1}, 0, -1, sp); !reflect.DeepEqual(got, []playPhase{{1400, sp.main}}) {
		t.Fatalf("plain: %v", got)
	}
}

func TestSpanTicks(t *testing.T) {
	t0 := time.Unix(1000, 0)
	a := span{fromTick: 0, toTick: 64, resumed: t0, paused: t0.Add(5 * time.Second), scale: 0.2}
	b := span{fromTick: 64, toTick: 96, resumed: t0.Add(6 * time.Second), paused: t0.Add(11 * time.Second), scale: 0.1}
	times := []time.Time{t0.Add(time.Second), t0.Add(5500 * time.Millisecond), t0.Add(8 * time.Second)}
	got := spanTicks(times, []span{a, b})
	if got[0] < 0 || got[0] > 64 || got[1] != -1 || got[2] < 64 || got[2] > 96 {
		t.Fatalf("ticks %v", got)
	}
}

func TestSpeedsFor(t *testing.T) {
	// 34 frames a second: full speed needs outputFPS per game second, the
	// slow motion twice that (slowmoSpeed 0.5).
	sp := speedsFor(34)
	if want := math.Floor(34/(outputFPS*captureHeadroom)*100) / 100; sp.main != want {
		t.Fatalf("main %v, want %v", sp.main, want)
	}
	if sp.slow >= sp.main || sp.slow < sp.main/2-0.011 {
		t.Fatalf("slow %v against main %v", sp.slow, sp.main)
	}
	// A fast stream plays faster than real time, up to maxCaptureSpeed.
	if sp := speedsFor(outputFPS * captureHeadroom * 10); sp.main != maxCaptureSpeed {
		t.Fatalf("fast stream: main %v", sp.main)
	}
	var c captureRate
	c.fps = 30
	c.observe(20)
	if c.fps != 20 {
		t.Fatalf("a drop counts at once: %v", c.fps)
	}
	c.observe(40)
	if c.fps <= 20 || c.fps >= 40 {
		t.Fatalf("a rise counts slowly: %v", c.fps)
	}
}

func TestWavSeconds(t *testing.T) {
	// 48 kHz stereo s16: 192000 bytes a second; 0.5 s of sound after a LIST chunk.
	var b []byte
	le := func(v uint32) []byte { return []byte{byte(v), byte(v >> 8), byte(v >> 16), byte(v >> 24)} }
	fmtChunk := append([]byte{1, 0, 2, 0}, append(le(48000), append(le(192000), 4, 0, 16, 0)...)...)
	b = append(b, "RIFF"...)
	b = append(b, le(0)...)
	b = append(b, "WAVE"...)
	b = append(b, "fmt "...)
	b = append(b, le(uint32(len(fmtChunk)))...)
	b = append(b, fmtChunk...)
	b = append(b, "LIST"...)
	b = append(b, le(4)...)
	b = append(b, "INFO"...)
	b = append(b, "data"...)
	b = append(b, le(0)...) // not finished: the size is counted from what is there
	b = append(b, make([]byte, 96000)...)
	p := filepath.Join(t.TempDir(), "a.wav")
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	if d, err := wavSeconds(p); err != nil || math.Abs(d-0.5) > 1e-9 {
		t.Fatalf("got %v, %v; want 0.5 s", d, err)
	}
}

func TestTimelineBlendsBetweenFrames(t *testing.T) {
	// Blending is off unless asked for (AT_BLEND=1).
	was := blendEdge
	blendEdge = 0.12
	defer func() { blendEdge = was }()
	// 1.5 captured frames per frame wanted: every other output frame falls
	// halfway between two captured ones and blends them.
	var ticks []float64
	for i := 0; i < 400; i++ {
		ticks = append(ticks, float64(i)*tickrate/(1.5*outputFPS))
	}
	frames, err := timeline([][]float64{ticks}, []segment{{From: 0, To: 2, Speed: 1}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	blended := 0
	for i, f := range frames {
		if f.next >= 0 {
			blended++
			if f.next != f.index+1 || f.weight <= blendEdge || f.weight >= 1-blendEdge {
				t.Fatalf("frame %d: %+v", i, f)
			}
		}
		if i > 0 && f.index < frames[i-1].index {
			t.Fatalf("frame %d goes back: %+v after %+v", i, f, frames[i-1])
		}
	}
	if blended < len(frames)/3 {
		t.Fatalf("only %d of %d blended", blended, len(frames))
	}
}

func TestBlendFrames(t *testing.T) {
	a, b := []byte{0, 100, 255}, []byte{200, 100, 55}
	blendFrames(a, b, 0.5)
	if a[0] != 100 || a[1] != 100 || a[2] != 155 {
		t.Fatalf("blend = %v", a)
	}
}

func TestBufferPTSAndTimes(t *testing.T) {
	line := "/GstPipeline:pipeline0/GstIdentity:tick: last-message = chain   ******* (tick:sink) (3110400 bytes, dts: none, pts: 0:00:02.019865458, duration: none, offset: -1)"
	if got := bufferPTS(line); math.Abs(got-2.019865458) > 1e-9 {
		t.Fatalf("pts = %v", got)
	}
	if bufferPTS("no pts here") != -1 {
		t.Fatal("no pts")
	}
	base := time.Unix(1000, 0)
	// Frames every 1/60 s, their lines arriving 5–40 ms late.
	var arrived []time.Time
	var pts []float64
	for i, late := range []int{5, 40, 12, 30, 5} {
		p := float64(i) / 60
		pts = append(pts, 10+p)
		arrived = append(arrived, base.Add(time.Duration((p+float64(late)/1000)*1e9)))
	}
	got := ptsTimes(arrived, pts)
	for i := 1; i < len(got); i++ {
		if d := got[i].Sub(got[i-1]).Seconds(); math.Abs(d-1.0/60) > 1e-6 {
			t.Fatalf("frame %d is %.4f s after the one before", i, d)
		}
	}
}

func TestDropRepeats(t *testing.T) {
	const fb = 6 * 4 * 3 / 2 * 100
	path := filepath.Join(t.TempDir(), "raw")
	var data []byte
	for i, v := range []byte{1, 2, 2, 3, 3, 3, 4} {
		_ = i
		frame := make([]byte, fb)
		for j := range frame {
			frame[j] = v
		}
		data = append(data, frame...)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	ticks := []float64{0, 1, 2, 3, 4, 5, 6}
	n, err := dropRepeats(path, fb, ticks)
	if err != nil || n != 3 {
		t.Fatalf("dropped %d (%v), ticks %v", n, err, ticks)
	}
	if ticks[2] != -1 || ticks[4] != -1 || ticks[5] != -1 || ticks[3] != 3 || ticks[6] != 6 {
		t.Fatalf("ticks %v", ticks)
	}
}

func TestTimelinePicksNearestByDefault(t *testing.T) {
	var ticks []float64
	for i := 0; i < 400; i++ {
		ticks = append(ticks, float64(i)*tickrate/(1.5*outputFPS))
	}
	frames, err := timeline([][]float64{ticks}, []segment{{From: 0, To: 2, Speed: 1}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range frames {
		if f.next >= 0 {
			t.Fatalf("blended %+v", f)
		}
	}
}

func TestTimelineBorrowsFromASlowedCapture(t *testing.T) {
	// The full-speed capture misses ticks 20-60 (a 40-tick hitch, past
	// maxHoleTicks); the slowed one has every tick: the clip takes those.
	var full, slow []float64
	for k := 0; k <= 64; k++ {
		if k < 20 || k > 60 {
			full = append(full, float64(k))
		}
		slow = append(slow, float64(k))
	}
	frames, err := timeline([][]float64{full, slow}, []segment{{0, 1, 1}}, 0)
	if err != nil {
		t.Fatalf("the hole was not filled from the slowed capture: %v", err)
	}
	borrowed := 0
	for _, f := range frames {
		if f.source == 1 {
			borrowed++
		}
	}
	if borrowed == 0 {
		t.Fatal("no frame came from the slowed capture")
	}
}
