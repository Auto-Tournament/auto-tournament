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
	if fmt.Sprint(rs) != "[{3 2 false} {4 5.5 false} {6 1 false}]" {
		t.Fatalf("reactions %v", rs)
	}
}

func TestCrowdTrackIsTheCrowdAlone(t *testing.T) {
	f := crowdBedFilter(10)
	for _, want := range []string{"[0:a]", "apad,atrim=duration=10.000[side]", "[1:a]", "asetrate=24000", "volume=0.07[cb]", "[cb][side]sidechaingate", "[bed]"} {
		if !strings.Contains(f, want) {
			t.Fatalf("crowd bed filter has no %q:\n%s", want, f)
		}
	}
	r := crowdReactsFilter([]crowdReact{{in: 1, at: 9, score: 3, length: 3}, {in: 2, at: 14, score: 5, length: 4}})
	for _, want := range []string{"[1:a]", "[2:a]", "adelay=9000", "[0:a][reacts]amix=inputs=2:duration=first", "[crowd]"} {
		if !strings.Contains(r, want) {
			t.Fatalf("reactions filter has no %q:\n%s", want, r)
		}
	}
	if strings.HasPrefix(r, ";") || crowdReactsFilter(nil) != "[0:a]anull[crowd]" {
		t.Fatalf("reactions filter: %q", r)
	}
	// The reel itself keeps only the game.
	if strings.Contains(reelFilter(reelPlan{durations: []float64{10, 8}, joins: []join{joinWipe}, width: 1920, height: 1080, fps: 60}), "bed") {
		t.Fatal("a reel without a crowd plan has a crowd")
	}
}

func TestReactionsVaryInPitch(t *testing.T) {
	a := reactionRate(crowdReact{at: 10, from: 7, score: 5})
	b := reactionRate(crowdReact{at: 31.4, from: 24, score: 5})
	if a == b {
		t.Fatalf("two whoas at the same rate: %v", a)
	}
	for _, r := range []crowdReact{{at: 3, score: 1}, {at: 8, score: 3}, {at: 12, score: 6}, {at: 40.2, from: 9.6, score: 1.5}} {
		if v := reactionRate(r); v < 0.87 || v > 1.1 {
			t.Fatalf("rate %v for %+v", v, r)
		}
	}
	if reactionRate(crowdReact{at: 12, score: 6}) >= reactionRate(crowdReact{at: 12, score: 1}) {
		t.Fatal("a whoa should sit lower than a hey")
	}
	if f := crowdReactsFilter([]crowdReact{{in: 1, at: 9, score: 3, length: 3}}); !strings.Contains(f, "asetrate=") {
		t.Fatalf("no rate change: %s", f)
	}
}

func TestCrowdGroansWhenThePlayerDies(t *testing.T) {
	me := "p1"
	rp := &Replay{Kills: []ReplayKill{
		{Tick: 1000, Attacker: &me, Victim: "x"},
		{Tick: 2500, Victim: me},
		{Tick: 9000, Victim: me}, // after the moment: not its death
	}}
	m := moment{StartTick: 500, EndTick: 3000}
	if got := deathTick(rp, me, m); got != 2500 {
		t.Fatalf("death %d, want 2500", got)
	}
	if got := deathTick(rp, "other", m); got != -1 {
		t.Fatalf("no death: %d", got)
	}
	rs := withAww([]reaction{{T: 1, Score: 2}, {T: 4, Score: 3}}, 2.345)
	if fmt.Sprint(rs) != "[{1 2 false} {2.35 0 true} {4 3 false}]" {
		t.Fatalf("reactions %v", rs)
	}
	if got := withAww(nil, -1); len(got) != 0 {
		t.Fatalf("no death, no groan: %v", got)
	}
	// On the reel's timeline like a cheer, with its own recording and level.
	p := reelPlan{durations: []float64{10}}
	out := crowdReactions(p, 0, [][]reaction{{{T: 2, Aww: true}}})
	if len(out) != 1 || !out[0].aww || out[0].from != awwFrom || out[0].length != awwLength {
		t.Fatalf("groan %+v", out)
	}
	if f := reactFilter(out); !strings.Contains(f, fmt.Sprintf("volume=%g", awwGain)) {
		t.Fatalf("groan filter %s", f)
	}
}

func TestTickAtFollowsTheEdit(t *testing.T) {
	ws := []window{{from: 0, to: 640}, {from: 1000, to: 1640}}
	segs := [][]segment{{{From: 0, To: 10, Speed: 1}}, {{From: 0, To: 10, Speed: 1}}}
	if got := tickAt(ws, segs, 320); got != 5 {
		t.Fatalf("first window: %v", got)
	}
	if got := tickAt(ws, segs, 1064); math.Abs(got-(10-reelCrossfade+1)) > 1e-9 {
		t.Fatalf("second window: %v", got)
	}
	if got := tickAt(ws, segs, 800); got != -1 {
		t.Fatalf("between windows: %v", got)
	}
}
