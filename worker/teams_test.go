package main

import "testing"

func TestTeamsOfCountsWinsAcrossTheSideSwap(t *testing.T) {
	ct, tt := "CT", "T"
	rounds := []Round{{Number: 1, Winner: &ct}, {Number: 2, Winner: &tt}, {Number: 3, Winner: &ct}}
	// a1/a2 start CT, swap to T in round 3.
	sides := map[int]map[string]string{
		1: {"a1": "CT", "a2": "CT", "b1": "T", "b2": "T"},
		2: {"a1": "CT", "a2": "CT", "b1": "T", "b2": "T"},
		3: {"a1": "T", "a2": "T", "b1": "CT", "b2": "CT"},
	}
	clans := map[int]map[string]string{1: {"CT": "", "T": "Bravo"}, 2: {"CT": "Alpha", "T": "Bravo"}}
	got := teamsOf(rounds, sides, clans)
	if len(got) != 2 {
		t.Fatalf("want 2 teams, got %d", len(got))
	}
	a, b := got[0], got[1]
	if a.StartSide != "CT" || a.Name != "Alpha" || a.Score != 1 || len(a.Players) != 2 {
		t.Errorf("team a: %+v", a)
	}
	if b.StartSide != "T" || b.Name != "Bravo" || b.Score != 2 {
		t.Errorf("team b: %+v", b)
	}
	if teamsOf(nil, map[int]map[string]string{}, nil) != nil {
		t.Error("no round one: no teams")
	}
}
