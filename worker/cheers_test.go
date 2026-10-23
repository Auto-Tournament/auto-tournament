package main

import "testing"

func TestHeadshots(t *testing.T) {
	me, them := "1", "2"
	rp := &Replay{Kills: []ReplayKill{
		{Tick: 100, Attacker: &me, Headshot: true},
		{Tick: 200, Attacker: &them, Headshot: true},
		{Tick: 200, Attacker: &me},
	}}
	got := headshots(rp, me, []int{100, 200}, 2)
	if len(got) != 2 || !got[0] || got[1] {
		t.Fatalf("got %v", got)
	}
	if headshots(rp, me, []int{200}, 1) != nil {
		t.Fatal("no headshots should be nil")
	}
	if headshots(rp, me, []int{100}, 2) != nil {
		t.Fatal("kills that don't line up should be nil")
	}
}
