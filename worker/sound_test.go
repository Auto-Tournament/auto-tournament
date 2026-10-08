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

func TestSoundFilterCrowdSwellsAtCheers(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 10, 8}, joins: []join{joinWipe, joinFade}}
	f := soundFilter(p, reelSound{music: "m.mp3", crowd: "c.mp3", kills: [][]float64{nil, {3}, {2, 5}}}, 3, 4, true)
	for _, want := range []string{"[3:a]aresample=48000", "[4:a]aresample=48000", "amix=inputs=3:duration=first:normalize=0[amix]", "if(lt(t,"} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	// The crowd starts with the first clip, and swells crowdDelay after each cheered kill.
	starts := partStarts(p)
	if !strings.Contains(f, "adelay="+strconv.Itoa(int(math.Round(starts[1]*1000)))+":all=1[crowd]") {
		t.Fatalf("crowd does not start with the first clip: %s", f)
	}
	at := fmt.Sprintf("(t-%.3f)", starts[1]+3+crowdDelay-starts[1])
	if !strings.Contains(f, at) || strings.Count(f, "min(1,max(0,(t-") != 3 {
		t.Fatalf("swells not at the cheers (%s): %s", at, f)
	}
	if plain := soundFilter(p, reelSound{}, -1, -1, true); plain != ";[a]anull[amix]" {
		t.Fatalf("no sound: %s", plain)
	}
}

func TestCheersOnlyForImpressiveKills(t *testing.T) {
	me, them := "76561190000000001", "76561190000000002"
	k := func(tick int, f func(*ReplayKill)) ReplayKill {
		r := ReplayKill{Tick: tick, Attacker: &me, Victim: them, Weapon: "AK-47"}
		if f != nil {
			f(&r)
		}
		return r
	}
	rp := &Replay{Players: []ReplayPlayer{{ID: me}, {ID: them}}, Kills: []ReplayKill{
		k(1000, nil), // plain
		k(1300, nil), // plain, second of a run
		k(1500, nil), // third within 10 s: a run
		k(4000, func(r *ReplayKill) { r.NoScope = true }),
		k(4050, func(r *ReplayKill) { r.Penetrated = true }), // a wallbang, but too close to the last cheer
		k(9000, nil), // last kill, plain kind
	}}
	m := moment{Kind: "3k", Title: "6 kills", KillTicks: []int{1000, 1300, 1500, 4000, 4050, 9000}}
	got := cheerTicks(rp, me, m)
	want := []int{1500, 4000}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("cheers %v, want %v", got, want)
	}
	m.Title = "6 kills clutch"
	if got := cheerTicks(rp, me, m); got[len(got)-1] != 9000 {
		t.Fatalf("a clutch's last kill cheers: %v", got)
	}
	if ts := cheerTimes(m.KillTicks, []float64{1, 2, 3, 4, 5, 6}, []int{1500, 9000}); len(ts) != 2 || ts[0] != 3 || ts[1] != 6 {
		t.Fatalf("cheer times %v", ts)
	}
}
