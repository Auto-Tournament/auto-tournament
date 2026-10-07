package main

import (
	"math"
	"testing"
	"time"
)

func TestWindowForMapsFramesToTicks(t *testing.T) {
	// 40 s of wall time at a quarter speed is 10 s (640 ticks) of game; 25
	// frames a second, starting 1 s before the resume (paused frames).
	t0 := time.Unix(1000, 0)
	s := span{fromTick: 1000, toTick: 1640, resumed: t0.Add(time.Second), paused: t0.Add(41 * time.Second)}
	var times []time.Time
	for i := 0; i < 25*43; i++ {
		times = append(times, t0.Add(time.Duration(i)*40*time.Millisecond))
	}
	w, err := windowFor(times, s, 1064, 1576) // the middle 8 s of game
	if err != nil {
		t.Fatal(err)
	}
	// Tick 1064 is 1 s of game (4 s of wall) after the resume: frame 125.
	if w.first != 125 {
		t.Fatalf("first frame %d", w.first)
	}
	// 25 frames per wall second at a quarter speed is 100 per game second.
	if math.Abs(w.rate-100) > 0.5 {
		t.Fatalf("rate %v", w.rate)
	}
}

func TestWindowForNeedsFrames(t *testing.T) {
	if _, err := windowFor(nil, span{}, 0, 10); err == nil {
		t.Fatal("no frames should fail")
	}
}
