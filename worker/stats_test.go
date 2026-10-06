package main

import (
	"math"
	"testing"
)

func str(s string) *string { return &s }

// Two a side: CT a1, a2 against T b1, b2. One round, which T wins.
const (
	a1 = "76561198000000001"
	a2 = "76561198000000002"
	b1 = "76561198000000003"
	b2 = "76561198000000004"
)

func kill(tick int, attacker, victim, aSide, vSide string) Kill {
	return Kill{Tick: tick, Round: 1, Attacker: str(attacker), Victim: victim, AttackerSide: str(aSide), VictimSide: str(vSide)}
}

func TestOpeningsTradesClutches(t *testing.T) {
	// a1 opens on b1; b2 trades a1 within five seconds; then b2 clutches a2.
	kills := []Kill{
		kill(1000, a1, b1, "CT", "T"),
		kill(1000+TradeTicks-10, b2, a1, "T", "CT"),
		kill(2000, b2, a2, "T", "CT"),
	}
	MarkOpeningsAndTrades(kills)
	if !kills[0].Opening || !kills[0].Traded || !kills[1].Trade || kills[2].Trade {
		t.Fatalf("flags: %+v", kills)
	}
	players := map[string]*PlayerStats{}
	stats := func(id string) *PlayerStats {
		if players[id] == nil {
			players[id] = &PlayerStats{}
		}
		return players[id]
	}
	CountKills(kills, stats)
	CountClutches(Round{Number: 1, Winner: str("T")}, map[string]string{a1: "CT", a2: "CT", b1: "T", b2: "T"}, kills, stats)

	if players[a1].OpeningKills != 1 || players[b1].OpeningDeaths != 1 {
		t.Errorf("openings: a1 %d, b1 %d", players[a1].OpeningKills, players[b1].OpeningDeaths)
	}
	if players[b2].TradeKills != 1 || players[b1].TradedDeaths != 1 || players[a1].TradedDeaths != 0 {
		t.Errorf("trades: b2 %d, b1 %d, a1 %d", players[b2].TradeKills, players[b1].TradedDeaths, players[a1].TradedDeaths)
	}
	// b2 was the last T once b1 fell (a 1v2), and the T side won.
	if players[b2].ClutchesPlayed != 1 || players[b2].ClutchesWon != 1 {
		t.Errorf("clutch: %+v", players[b2])
	}
	for _, rd := range []Round{{Number: 1, Winner: str("T")}} {
		CountKast(rd, map[string]string{a1: "CT", a2: "CT", b1: "T", b2: "T"}, kills, stats)
	}
	// a1 killed, b1's death was traded, b2 killed and survived; a2 did nothing and died.
	for id, want := range map[string]int{a1: 1, a2: 0, b1: 1, b2: 1} {
		if players[id].KastRounds != want {
			t.Errorf("KAST %s: %d, want %d", id, players[id].KastRounds, want)
		}
	}
	if players[b2].MultiKills != [5]int{0, 1, 0, 0, 0} {
		t.Errorf("multi: %v", players[b2].MultiKills)
	}
}

func TestShotsHitsSprays(t *testing.T) {
	s := &PlayerStats{}
	// A four-bullet spray; the first and the fourth hit; then a lone shot.
	shots := []Shot{{996, "AK-47"}, {1004, "AK-47"}, {1012, "AK-47"}, {1020, "AK-47"}, {1200, "AK-47"}}
	CountShots(s, shots, []int{997, 1021})
	if s.Shots != 5 || s.Hits != 2 || s.SprayShots != 1 || s.SprayHits != 1 {
		t.Fatalf("got %+v", s)
	}
}

func TestAimError(t *testing.T) {
	cases := []struct {
		pitch, yaw float64
		target     [3]float64
		want       float64
	}{
		{0, 0, [3]float64{100, 0, 0}, 0},
		{0, 0, [3]float64{0, 100, 0}, 90},
		{10, 0, [3]float64{100, 0, 0}, 10}, // looking down at a level target
	}
	for _, c := range cases {
		if got := AimError([3]float64{}, c.pitch, c.yaw, c.target); math.Abs(got-c.want) > 0.001 {
			t.Errorf("AimError(%v, %v, %v) = %v, want %v", c.pitch, c.yaw, c.target, got, c.want)
		}
	}
}
