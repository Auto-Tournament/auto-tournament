package main

import "testing"

func TestScoreFramesCountsRepeatsAndJumps(t *testing.T) {
	// 100 frames that move evenly (change 2.0), with 3 repeats and 2 jumps.
	d := make([]float64, 100)
	for i := range d {
		d[i] = 2.0
	}
	d[20], d[40], d[60] = 0.1, 0.2, 0.0 // repeats
	d[30], d[70] = 9.0, 6.0             // jumps
	q := scoreFrames(d)
	if q.Moving != 84 {
		t.Fatalf("moving: want 84, got %d", q.Moving)
	}
	if q.RepeatPct != 3.6 || q.JumpPct != 2.4 {
		t.Errorf("want 3.6%% repeats and 2.4%% jumps, got %+v", q)
	}
}

func TestScoreFramesSkipsStillStretches(t *testing.T) {
	d := make([]float64, 60) // a held card: nothing moves
	if q := scoreFrames(d); q.Moving != 0 || q.RepeatPct != 0 {
		t.Errorf("a still clip has nothing to judge, got %+v", q)
	}
}
