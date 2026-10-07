package main

import (
	"math"
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

func TestReelFilterIntroGrid(t *testing.T) {
	p := reelPlan{durations: []float64{10, 8, 9}, joins: []join{joinWipe, joinFade}, intro: true, width: 1920, height: 1080, fps: 60}
	f := reelFilter(p)
	for _, want := range []string{
		// Three clips: a 2×2 grid, the first clip in two tiles.
		"[0:v]setpts=PTS-STARTPTS,trim=duration=10.000,fps=60,settb=AVTB,setsar=1,format=yuv420p,split=3[v0in][g0_0][g0_1]",
		"xstack=inputs=4:layout=0_0|960_0|0_540|960_540",
		"drawbox=color=0x080504@0.75:t=fill",
		// In slow motion, from the top of the frame (no caption card).
		"setpts=(PTS-STARTPTS)*4,fps=60,crop=iw:ih*0.62:0:0",
		// The intro's text (input 3) over the grid, then the wipe to the first clip.
		"[3:v]format=rgba[introtext]",
		"[vintro][wc1]xfade=transition=wiperight",
		// One player's two clips blend.
		"xfade=transition=fade:duration=0.4",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	want := introSec + 10 + 8 + 9 + 2*wipeHoldSec - reelCrossfade
	if got := reelLength(p); math.Abs(got-want) > 1e-9 {
		t.Fatalf("length = %v, want %v", got, want)
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
