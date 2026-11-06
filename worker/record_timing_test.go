package main

import (
	"testing"
)

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
