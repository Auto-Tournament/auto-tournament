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
