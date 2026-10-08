package main

import (
	"math"
	"strconv"
	"strings"
	"testing"
)

func TestReelFilterWipesBetweenPlayers(t *testing.T) {
	p := reelPlan{durations: []float64{10, 8}, joins: []join{joinWipe}, width: 1920, height: 1080, fps: 60}
	f := reelFilter(p)
	for _, want := range []string{
		"color=c=0xff6a3d:s=1920x1080:r=60:d=0.550,fps=60,settb=AVTB",
		// The bar sweeps in over the end of the first clip...
		"[v0in][wc1]xfade=transition=wiperight:duration=0.25:offset=9.750[wv1]",
		// ...and out over the start of the next, after a beat of orange.
		"[wv1][v1in]xfade=transition=wiperight:duration=0.25:offset=10.050[v]",
		"[a0in][ws1]acrossfade=d=0.25[wa1]",
		"[wa1][a1in]acrossfade=d=0.25[a]",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if got := reelLength(p); math.Abs(got-18.05) > 1e-9 {
		t.Fatalf("length = %v, want 18.05", got)
	}
}

func TestIntroFilterAndTiles(t *testing.T) {
	tiles := introTiles([]float64{10, 8, 9})
	// Three clips: a 2×2 grid, the first clip in two tiles at different stretches.
	if len(tiles) != 4 || tiles[0].Clip != 0 || tiles[3].Clip != 0 || tiles[0].Start == tiles[3].Start {
		t.Fatalf("tiles = %+v", tiles)
	}
	for _, tile := range tiles {
		if tile.Start < 0 || tile.Start+introSec/introSlowdown > []float64{10, 8, 9}[tile.Clip]+1e-9 {
			t.Fatalf("tile past its clip: %+v", tile)
		}
	}
	f := introFilter(2, 2, 1920, 1080, 60)
	for _, want := range []string{
		"xstack=inputs=4:layout=0_0|960_0|0_540|960_540",
		"drawbox=color=0x080504@0.75:t=fill",
		// In slow motion, from the top of the frame (no caption card).
		"[0:v]setpts=(PTS-STARTPTS)*4,fps=60,crop=iw:ih*0.62:0:0",
		// The text (the input after the tiles) over the grid.
		"[4:v]format=rgba[text]",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
}

func TestReelWithIntroLength(t *testing.T) {
	p := reelPlan{durations: []float64{introSec, 10, 8, 9}, joins: []join{joinWipe, joinWipe, joinFade}, width: 1920, height: 1080, fps: 60}
	want := introSec + 10 + 8 + 9 + 2*wipeHoldSec - reelCrossfade
	if got := reelLength(p); math.Abs(got-want) > 1e-9 {
		t.Fatalf("length = %v, want %v", got, want)
	}
	if f := reelFilter(p); !strings.Contains(f, "[v0in][wc1]xfade=transition=wiperight") {
		t.Fatalf("no wipe from the intro: %s", f)
	}
}

func TestJoinsByPlayer(t *testing.T) {
	got := joinsByPlayer([]string{"a", "a", "b", "c", "c"})
	want := []join{joinFade, joinWipe, joinWipe, joinFade}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("joins = %v, want %v", got, want)
		}
	}
}

func TestTitleCase(t *testing.T) {
	if got := titleCase("ESL PRO LEAGUE SEASON 24 · SEMI-FINAL"); got != "ESL Pro League Season 24 · Semi-final" {
		t.Fatalf("titleCase = %q", got)
	}
}

func TestIntroRenders(t *testing.T) {
	r, err := reelIntro{Kicker: "Match highlights", Title: "9z vs BETBOOM", Meta: "ESL Pro League Season 24", Date: "Dust II · 7 October 2026"}.layout(1280, 720)
	if err != nil {
		t.Fatal(err)
	}
	if r.Frames() != int(math.Ceil(introSec*cardFPS)) {
		t.Fatalf("frames = %d", r.Frames())
	}
	// Nothing drawn before the text comes in; something once it has.
	empty := func(t float64) bool {
		pix := r.frameAt(t).Pix
		for i := 3; i < len(pix); i += 4 {
			if pix[i] != 0 {
				return false
			}
		}
		return true
	}
	if !empty(0) {
		t.Fatal("text at 0 s")
	}
	if empty(2.5) {
		t.Fatal("no text at 2.5 s")
	}
}

func TestPartStarts(t *testing.T) {
	// The intro, a wipe to the first clip, a fade to the same player's next,
	// a wipe to another player's.
	p := reelPlan{durations: []float64{introSec, 10, 8, 6}, joins: []join{joinWipe, joinFade, joinWipe}}
	got := partStarts(p)
	want := []float64{0, 4.45, 14.05, 22.1}
	for i := range want {
		if math.Abs(got[i]-want[i]) > 1e-9 {
			t.Fatalf("starts %v, want %v", got, want)
		}
	}
	if end := got[3] + 6; math.Abs(end-reelLength(p)) > 1e-9 {
		t.Fatalf("the last part ends at %.3f, the reel at %.3f", end, reelLength(p))
	}
	if h := startsHeader(got[1:]); h != "4.45,14.05,22.10" {
		t.Fatalf("header %q", h)
	}
}

func TestReelOutroHoldsThenFades(t *testing.T) {
	p := reelPlan{durations: []float64{10, 8}, joins: []join{joinWipe}, width: 1920, height: 1080, fps: 60, outro: true}
	f := reelFilter(p)
	end := 10 + 8 + wipeHoldSec + outroHold
	for _, want := range []string{
		"[vj]tpad=stop_mode=clone:stop_duration=0.8,fade=t=out:st=" + strconv.FormatFloat(end-outroFade, 'f', 3, 64) + ":d=1.4[v]",
		"[aj]apad=pad_dur=0.8,afade=t=out:st=",
		"[wa1][a1in]acrossfade=d=0.25[aj]",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("no %q in:\n%s", want, f)
		}
	}
	if math.Abs(reelLength(p)-end) > 1e-9 {
		t.Fatalf("length %.3f, want %.3f", reelLength(p), end)
	}
	// A clip's pieces join without it.
	p.outro = false
	if strings.Contains(reelFilter(p), "tpad") {
		t.Fatal("outro without asking")
	}
}
