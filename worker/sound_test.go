package main

import (
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

func TestSoundFilterCheersAtKills(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 10, 8}, joins: []join{joinWipe, joinFade}}
	f := soundFilter(p, reelSound{music: "m.mp3", crowd: "c.mp3", kills: [][]float64{nil, {3}, {2, 5}}}, 3, 4, true)
	for _, want := range []string{"[3:a]aresample=48000", "[4:a]aresample=48000,aformat=channel_layouts=stereo,asplit=3",
		"amix=inputs=5:duration=first:normalize=0[amix]", "if(lt(t,"} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	// The first cheer: part 1's kill at 3 s, crowdLead early.
	at := int(math.Round((partStarts(p)[1] + 3 - crowdLead) * 1000))
	if !strings.Contains(f, "adelay="+strconv.Itoa(at)+":all=1[cheer0]") {
		t.Fatalf("first cheer not at %d ms: %s", at, f)
	}
	if plain := soundFilter(p, reelSound{}, -1, -1, true); plain != ";[a]anull[amix]" {
		t.Fatalf("no sound: %s", plain)
	}
}
