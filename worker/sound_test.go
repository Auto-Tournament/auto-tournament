package main

import (
	"fmt"
	"math"
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

func TestCrowdIsPartOfEachClip(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 10, 8}, joins: []join{joinWipe, joinFade}, fps: 60, width: 1920, height: 1080,
		crowd: &partCrowd{input: 3, first: 1, heys: [][]float64{nil, {6}, nil}, roars: [][]float64{nil, nil, {5}}}}
	f := reelFilter(p) + soundFilter(p, reelSound{music: "m.mp3"}, 4, true)
	for _, want := range []string{
		"[3:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[crowd1][crowd2];",
		"[1:a]asetpts=PTS-STARTPTS,apad,atrim=duration=10.000[a1raw]",
		"[0:a]asetpts=PTS-STARTPTS,apad,atrim=duration=4.400[a0in]", // no crowd under the intro
		"sidechaingate=",
		"[a1game][crowdmix1]amix=inputs=2:duration=first:normalize=0[a1in]",
		fmt.Sprintf("(t-%.3f)/0.2", 6+crowdDelay),  // part 1's heeey, in the part's own time
		fmt.Sprintf("(t-%.3f)/0.35", 5+crowdDelay), // part 2's roar
		fmt.Sprintf("if(lt(t,%.3f),0", cardExit+introUpSec),
		"[a][music]amix=inputs=2",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
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
