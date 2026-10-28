package main

import "testing"

func TestOneTap(t *testing.T) {
	deagle := func(ticks ...int) []Shot {
		s := make([]Shot, len(ticks))
		for i, tk := range ticks {
			s[i] = Shot{Tick: tk, Weapon: "Desert Eagle"}
		}
		return s
	}
	if !oneTap(deagle(1000), 1002, 64, "Desert Eagle", true) {
		t.Fatal("one bullet, headshot: a one-tap")
	}
	// The 2026-10-28 reel: a missed first bullet, then the headshot.
	if oneTap(deagle(960, 1000), 1002, 64, "Desert Eagle", true) {
		t.Fatal("a miss before the headshot is not a one-tap")
	}
	if !oneTap(deagle(900, 1000), 1002, 64, "Desert Eagle", true) {
		t.Fatal("a shot more than a second before is another moment")
	}
	if oneTap(deagle(1000), 1002, 64, "Desert Eagle", false) || oneTap([]Shot{{1000, "AWP"}}, 1002, 64, "AWP", true) {
		t.Fatal("not a headshot, or a sniper rifle: no")
	}
	if oneTap(nil, 1002, 64, "AK-47", true) {
		t.Fatal("no shot seen: no")
	}
}
