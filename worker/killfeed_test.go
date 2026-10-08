package main

import (
	"os"
	"path/filepath"
	"testing"
)

func testIcons(t *testing.T) *iconSet {
	t.Helper()
	dir := t.TempDir()
	box := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><path fill="#FFFFFF" d="M0 0h64v32H0z"/></svg>`
	square := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#FFFFFF" d="M0 0h32v32H0z"/></svg>`
	for _, f := range []struct{ path, svg string }{
		{"weapons/usp_silencer.svg", box}, {"deathnotice/icon_headshot.svg", square}, {"deathnotice/icon_suicide.svg", square},
	} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, f.path)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f.path), []byte(f.svg), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(`{"icons":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return newIconSet(dir)
}

func TestIconsRasterToScale(t *testing.T) {
	icons := testIcons(t)
	img := icons.icon("weapons", "usp_silencer", 19)
	if img == nil || img.Bounds().Dy() != 19 || img.Bounds().Dx() != 38 {
		t.Fatalf("icon = %v", img)
	}
	if img.RGBAAt(19, 9).A == 0 {
		t.Fatal("icon drawn empty")
	}
	if icons.icon("weapons", "nope", 19) != nil {
		t.Fatal("a missing icon drew something")
	}
}

func TestFeedRowsStayOrGo(t *testing.T) {
	icons := testIcons(t)
	kills := []feedKill{
		{At: -1, Killer: "d1Ledez", Victim: "Kvasen", KillerMine: true, Weapon: "USP-S", Headshot: true, Own: true},
		{At: 1, Killer: "dgt", Victim: "Tundra", KillerMine: true, Weapon: "USP-S"},
		{At: 2, Killer: "d1Ledez", Victim: "Fjord", KillerMine: true, Weapon: "USP-S", Own: true},
	}
	r, err := layoutFeed(kills, 1280, 720, 12, icons)
	if err != nil {
		t.Fatal(err)
	}
	rows := func(t0 float64) int {
		// Count drawn rows by the plates' left edges down the right side.
		img := r.frameAt(t0)
		n, inRow := 0, false
		x := img.Bounds().Dx() - 3
		for y := 0; y < img.Bounds().Dy(); y++ {
			on := img.RGBAAt(x, y).A > 200
			if on && !inRow {
				n++
			}
			inRow = on
		}
		return n
	}
	if got := rows(0); got != 1 {
		t.Fatalf("at 0 s: %d rows, want the carried-over one", got)
	}
	if got := rows(3); got != 3 {
		t.Fatalf("at 3 s: %d rows, want 3", got)
	}
	// Someone else's kill goes after killFeedHoldSec; the player's stay.
	if got := rows(1 + killFeedHoldSec + killFeedFadeSec + 0.1); got != 2 {
		t.Fatalf("after the hold: %d rows, want 2", got)
	}
	if r.region.Min.X%2 != 0 || r.region.Dx()%2 != 0 || r.region.Dy()%2 != 0 {
		t.Fatalf("region not even: %v", r.region)
	}
}

func TestFeedKillsFromReplay(t *testing.T) {
	me, them, mate := "76561190000000001", "76561190000000002", "76561190000000003"
	rp := &Replay{
		Players: []ReplayPlayer{{ID: me, Name: "d1Ledez"}, {ID: them, Name: "Kvasen"}, {ID: mate, Name: "dgt"}},
		Frames:  [][2]any{{100, []any{[6]float64{0, 0, 0, 100, 3, 0}, [6]float64{0, 0, 0, 100, 2, 0}, [6]float64{0, 0, 0, 100, 3, 0}}}},
		Kills: []ReplayKill{
			{Tick: 120, Attacker: &me, Victim: them, Weapon: "USP-S", Headshot: true, Assister: &mate},
			{Tick: 130, Attacker: &them, Victim: mate, Weapon: "AK-47"},
			{Tick: 900, Attacker: &me, Victim: them, Weapon: "USP-S"},
		},
	}
	got := feedKillsFor(rp, me, 110, 200)
	if len(got) != 2 {
		t.Fatalf("kills = %+v", got)
	}
	if !got[0].Own || !got[0].KillerMine || got[0].VictimMine || got[0].Assister != "dgt" || !got[0].Headshot {
		t.Fatalf("first = %+v", got[0])
	}
	if got[1].Own || got[1].KillerMine || !got[1].VictimMine {
		t.Fatalf("second = %+v", got[1])
	}
}
