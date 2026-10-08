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
	p := reelPlan{durations: []float64{4.4, 10, 8}, joins: []join{joinWipe, joinFade}, fps: 60, width: 1920, height: 1080}
	reacts := crowdReactions(p, 1, [][]reaction{nil, {{T: 6, Score: 1.5}}, {{T: 7.5, Score: 5}}})
	for k := range reacts {
		reacts[k].in = 5 + k
	}
	p.crowd = &partCrowd{first: 1, bedIn: map[int]int{1: 3, 2: 4}, reacts: reacts}
	f := reelFilter(p) + soundFilter(p, reelSound{music: "m.mp3"}, 7, true)
	starts := partStarts(p)
	for _, want := range []string{
		"[1:a]asetpts=PTS-STARTPTS,apad,atrim=duration=10.000[a1raw]",
		"[0:a]asetpts=PTS-STARTPTS,apad,atrim=duration=4.400[a0in]", // no crowd under the intro
		"[3:a]aresample=48000", "[4:a]aresample=48000", // each clip's murmur, its own input
		"sidechaingate=",
		fmt.Sprintf("asetrate=%d", int(48000*slowmoSpeed)), // the opening's murmur, slowed
		"[a1game][bed1]amix=inputs=2:duration=first:normalize=0[a1in]",
		fmt.Sprintf("volume=%g,adelay=%d:all=1[react0]", heyGain, int(math.Round((starts[1]+6+crowdDelay)*1000))),
		fmt.Sprintf("volume=%g,adelay=%d:all=1[react1]", wowGain, int(math.Round((starts[2]+7.5+crowdDelay)*1000))),
		"[a][music][reacts]amix=inputs=3",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	// The whoaaa near the end of the last clip runs at most crowdSpill past it.
	if r := reacts[1]; r.length > 8-(7.5+crowdDelay)+crowdSpill+1e-9 {
		t.Fatalf("reaction runs %v past its clip", r.length)
	}
}

func TestCheersScaleWithHowImpressive(t *testing.T) {
	me, them := "76561190000000001", "76561190000000002"
	k := func(tick int, f func(*ReplayKill)) ReplayKill {
		r := ReplayKill{Tick: tick, Attacker: &me, Victim: them, Weapon: "AK-47", SeenFor: 2}
		if f != nil {
			f(&r)
		}
		return r
	}
	rp := &Replay{Players: []ReplayPlayer{{ID: me}, {ID: them}}, Kills: []ReplayKill{
		k(1000, nil), // plain: nothing
		k(1300, nil), // plain, second of a run: nothing
		k(1500, nil), // third within 10 s: a run (2)
		k(4000, func(r *ReplayKill) { r.ThroughSmoke, r.Penetrated, r.Headshot = true, true, true }), // smoke wallbang headshot: 5.5
		k(4040, func(r *ReplayKill) { r.Weapon = "AWP" }),                                            // too close to the last, smaller: dropped
		k(9000, func(r *ReplayKill) { r.Weapon = "AWP" }),                                            // an AWP kill: 1
	}}
	m := moment{Kind: "3k", Title: "6 kills", KillTicks: []int{1000, 1300, 1500, 4000, 4040, 9000}}
	got := cheerTicks(rp, me, m)
	want := []cheer{{1500, 2}, {4000, 5.5}, {9000, 1}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("cheers %v, want %v", got, want)
	}
	for _, c := range []struct {
		score float64
		gain  float64
	}{{1, heyGain}, {2.5, roarGain}, {5.5, wowGain}} {
		if g, _, _ := reactionShape(c.score); g != c.gain {
			t.Fatalf("score %v: gain %v, want %v", c.score, g, c.gain)
		}
	}
	rs := cheerTimes(m.KillTicks, []float64{1, 2, 3, 4, 5, 6}, got)
	if fmt.Sprint(rs) != "[{3 2} {4 5.5} {6 1}]" {
		t.Fatalf("reactions %v", rs)
	}
}
