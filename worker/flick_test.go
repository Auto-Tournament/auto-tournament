package main

import (
	"math"
	"testing"
)

func TestSwingFindsAFlickSpreadOverTicks(t *testing.T) {
	// 80 degrees in 10 ticks, 8 a tick: no two ticks far apart, still a flick
	var aim []tickYaw
	for i := 0; i <= 10; i++ {
		aim = append(aim, tickYaw{tick: 100 + i, yaw: 10 + 8*float64(i)})
	}
	if d := swing(aim, 110, 19); math.Abs(d-80) > 1e-9 {
		t.Fatalf("swing %v, want 80", d)
	}
	if swing(aim, 110, 19) < flickDegree {
		t.Fatal("a flick")
	}
	// across the 180/-180 seam: 170 to -170 is 20 degrees, not 340
	if d := swing([]tickYaw{{tick: 1, yaw: 170}, {tick: 2, yaw: -170}}, 2, 19); math.Abs(d-20) > 1e-9 {
		t.Fatalf("seam swing %v, want 20", d)
	}
	// a slow turn over a second is not
	slow := []tickYaw{{tick: 0, yaw: 0}, {tick: 64, yaw: 90}}
	if swing(slow, 64, 19) != 0 {
		t.Fatal("outside the window")
	}
}

func TestSpeed(t *testing.T) {
	// 250 units a second (running with a knife), sampled every tick at 64
	var aim []tickYaw
	for i := 0; i <= 10; i++ {
		aim = append(aim, tickYaw{tick: i, x: 250 * float64(i) / 64})
	}
	if v := speed(aim, 10, 9, 64); math.Abs(v-250) > 1e-6 || v <= movingSpeed {
		t.Fatalf("speed %v", v)
	}
	if speed(aim[:1], 0, 9, 64) != 0 || speed(nil, 5, 9, 64) != 0 {
		t.Fatal("no history: standing")
	}
}
