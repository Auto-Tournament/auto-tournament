package main

import "testing"

// The follow check reads where the demo has the player near a tick.
func TestReplayPositionAt(t *testing.T) {
	r := &Replay{
		Step:    16,
		Players: []ReplayPlayer{{ID: "a"}, {ID: "b"}},
		Frames: [][2]any{
			{100, []any{[6]float64{10, 20, 0, 100, 2, 30}, nil}},
			{116, []any{[6]float64{11, 21, 0, 100, 2, 31}, []any{5.0, 6.0, 0.0, 100.0, 3.0, 7.0}}},
		},
	}
	if p, ok := r.PositionAt("a", 120); !ok || p != [3]float64{11, 21, 31} {
		t.Fatalf("a at 120 = %v %v", p, ok)
	}
	if p, ok := r.PositionAt("b", 116); !ok || p != [3]float64{5, 6, 7} {
		t.Fatalf("b at 116 (decoded JSON) = %v %v", p, ok)
	}
	if _, ok := r.PositionAt("b", 100); ok {
		t.Fatal("b has no frame at 100 (not spawned)")
	}
	if _, ok := r.PositionAt("a", 50); ok {
		t.Fatal("no frame before 50")
	}
	if _, ok := r.PositionAt("a", 400); ok {
		t.Fatal("frame too old for 400")
	}
	if _, ok := r.PositionAt("c", 116); ok {
		t.Fatal("unknown player")
	}
	var nilReplay *Replay
	if _, ok := nilReplay.PositionAt("a", 116); ok {
		t.Fatal("nil replay")
	}
}
