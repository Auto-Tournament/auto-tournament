package main

import (
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
	// Full speed to tick 102, then a quarter speed over ticks 102-104 (15 frames).
	segs := []segment{{0, 102.0 / 64, 1}, {102.0 / 64, 104.0 / 64, 0.25}}
	frames, err := timeline([][]float64{main, slow}, segs, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(frames); got != 191+15 {
		t.Fatalf("%d frames", got)
	}
	usedSlow := 0
	for _, f := range frames[191:] {
		if f.source == 1 {
			usedSlow++
		}
	}
	if usedSlow < 12 {
		t.Fatalf("slow part used the slow capture for only %d of 15 frames", usedSlow)
	}
}

func TestTimelineRefusesAHole(t *testing.T) {
	if _, err := timeline([][]float64{{0, 1, 2}}, []segment{{0, 1, 1}}, 0); err == nil {
		t.Fatal("a second of game from three frames should fail")
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
