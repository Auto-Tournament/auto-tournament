package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"testing"
)

func TestPartStartsFollowTheJoins(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 10, 8}, joins: []join{joinWipe, joinFade}}
	s := partStarts(p)
	bar := wipeInSec*2 + wipeHoldSec
	want := []float64{0, 4.4 + bar - 2*wipeInSec, 4.4 + bar - 2*wipeInSec + 10 - reelCrossfade}
	for i := range want {
		if math.Abs(s[i]-want[i]) > 1e-9 {
			t.Fatalf("starts %v, want %v", s, want)
		}
	}
	// The last part ends where the reel does.
	if end := s[2] + 8; math.Abs(end-reelLength(p)) > 1e-9 {
		t.Fatalf("last part ends at %v, reel is %v", end, reelLength(p))
	}
}

func TestSoundFilterCrowdFollowsTheGame(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 10, 8}, joins: []join{joinWipe, joinFade}}
	f := soundFilter(p, reelSound{music: "m.mp3", crowd: "c.mp3", heys: [][]float64{nil, {3}, nil}, roars: [][]float64{nil, nil, {5}}}, 3, 4, true)
	for _, want := range []string{"[a]asplit=2[agame][asc]", "sidechaingate=", "[agame][music][crowd]amix=inputs=3", "if(lt(t,"} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	starts := partStarts(p)
	if !strings.Contains(f, "adelay="+strconv.Itoa(int(math.Round(starts[1]*1000)))+":all=1[crowd]") {
		t.Fatalf("crowd does not start with the first clip: %s", f)
	}
	hey := fmt.Sprintf("%g*min(1,max(0,(t-%.3f)/0.2))", heyGain, 3+crowdDelay)
	roar := fmt.Sprintf("%g*min(1,max(0,(t-%.3f)/0.35))", roarGain, starts[2]+5+crowdDelay-starts[1])
	if !strings.Contains(f, hey) || !strings.Contains(f, roar) {
		t.Fatalf("reactions not at the kills (%s, %s): %s", hey, roar, f)
	}
	if plain := soundFilter(p, reelSound{}, -1, -1, true); plain != ";[a]anull[amix]" {
		t.Fatalf("no sound: %s", plain)
	}
}

func TestCheersOnlyForImpressiveKills(t *testing.T) {
	me, them := "76561190000000001", "76561190000000002"
	k := func(tick int, f func(*ReplayKill)) ReplayKill {
		r := ReplayKill{Tick: tick, Attacker: &me, Victim: them, Weapon: "AK-47", SeenFor: 2}
		if f != nil {
			f(&r)
		}
		return r
	}
	rp := &Replay{Players: []ReplayPlayer{{ID: me}, {ID: them}}, Kills: []ReplayKill{
		k(1000, nil), // plain
		k(1300, nil), // plain
		k(1500, nil), // third within 10 s: a roar
		k(4000, func(r *ReplayKill) { r.SeenFor = 0.1 }),      // a snap shot: hey
		k(4050, func(r *ReplayKill) { r.Penetrated = true }),  // a wallbang, too close to the last
		k(7000, func(r *ReplayKill) { r.VictimInAir = true }), // the victim in the air: hey
		k(9000, func(r *ReplayKill) { r.RoundEnding = true }), // ends the round: roar
	}}
	m := moment{Kind: "3k", Title: "7 kills", KillTicks: []int{1000, 1300, 1500, 4000, 4050, 7000, 9000}}
	got := cheerTicks(rp, me, m)
	want := []cheer{{1500, true}, {4000, false}, {7000, false}, {9000, true}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("cheers %v, want %v", got, want)
	}
	heys, roars := cheerTimes(m.KillTicks, []float64{1, 2, 3, 4, 5, 6, 7}, got)
	if fmt.Sprint(heys) != "[4 6]" || fmt.Sprint(roars) != "[3 7]" {
		t.Fatalf("heys %v roars %v", heys, roars)
	}
}
