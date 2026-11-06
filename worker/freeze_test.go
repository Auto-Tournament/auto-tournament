package main

import "testing"

func TestStillShareOfCountsNearlySameFrames(t *testing.T) {
	stats := "n:1 Y:0.99 All:0.990 (20.0)\nn:2 Y:0.40 All:0.400 (2.2)\nn:3 Y:0.97 All:0.960 (14.0)\nn:4 Y:0.50 All:0.500 (3.0)\n"
	if got := stillShareOf(stats); got != 0.5 {
		t.Fatalf("got %v, want 0.5", got)
	}
	if got := stillShareOf(""); got != 0 {
		t.Fatalf("no frames: got %v", got)
	}
}
