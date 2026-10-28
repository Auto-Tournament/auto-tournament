package main

import "testing"

func TestShotsIn(t *testing.T) {
	shots := []Shot{{10, "AK-47"}, {50, "AK-47"}, {55, "Glock-18"}, {60, "AK-47"}, {70, "AK-47"}, {200, "AK-47"}}
	// the fight: first hit at tick 64, kill at 70, a second (64 ticks) of lead
	if n := shotsIn(shots, 0, 70, "AK-47"); n != 4 {
		t.Fatalf("%d shots, want 4 (the Glock and the shot after the kill don't count)", n)
	}
	if n := shotsIn(shots, 55, 70, "AK-47"); n != 2 {
		t.Fatalf("%d shots, want 2", n)
	}
	if shotsIn(nil, 0, 70, "AK-47") != 0 {
		t.Fatal("no shots")
	}
}
