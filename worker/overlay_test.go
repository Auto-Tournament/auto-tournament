package main

import (
	"image"
	"math"
	"path/filepath"
	"testing"
)

func TestClipOverlayPartsBlend(t *testing.T) {
	o := clipOverlay(1920, 1080, true, []float64{10, 6}, []overlayPart{{Card: &cardSpec{Name: "a"}}, {Settled: true}})
	if len(o.Parts) != 2 || o.Parts[1].Start != 10-reelCrossfade || o.Parts[0].FadeOut != reelCrossfade || o.Parts[1].FadeIn != reelCrossfade {
		t.Fatalf("parts %+v", o.Parts)
	}
	if math.Abs(o.Duration-(16-reelCrossfade)) > 1e-9 {
		t.Fatalf("duration %v", o.Duration)
	}
	if o.Parts[0].FadeIn != 0 || o.Parts[1].FadeOut != 0 {
		t.Fatal("a clip's own ends do not fade")
	}
}

func TestReelOverlayWipesAndOutro(t *testing.T) {
	a := clipOverlay(1920, 1080, false, []float64{8}, []overlayPart{{}})
	b := clipOverlay(1920, 1080, true, []float64{5, 5}, []overlayPart{{}, {}})
	o := reelOverlay([]overlayRecipe{a, b}, []float64{4.45, 12.5}, 30, true)
	if len(o.Parts) != 3 || o.Parts[1].Start != 12.5 || o.Parts[2].Start != 12.5+5-reelCrossfade {
		t.Fatalf("parts %+v", o.Parts)
	}
	if !o.Parts[0].WipeIn || !o.Parts[0].WipeOut || !o.Parts[1].WipeIn || o.Parts[1].WipeOut || o.Parts[2].WipeOut {
		t.Fatalf("wipes %+v", o.Parts)
	}
	if o.Parts[1].FadeOut != reelCrossfade || o.Parts[0].FadeIn != 0 {
		t.Fatalf("a clip's own pieces still blend: %+v", o.Parts)
	}
	// Halfway through the wipe out, the bar covers the left half.
	if from, to := o.Parts[0].shown(4.45+8-wipeInSec/2, 1920); from != 960 || to != 1920 {
		t.Fatalf("wipe out shows %d..%d", from, to)
	}
	if from, to := o.Parts[1].shown(12.5+wipeInSec/4, 1920); from != 0 || to != 480 {
		t.Fatalf("wipe in shows %d..%d", from, to)
	}
	if last := o.Parts[2]; last.FadeOut != outroFade || math.Abs(last.Duration-(5+outroHold)) > 1e-9 {
		t.Fatalf("outro %+v", last)
	}
	if !o.Logo || o.Width != 1920 || o.Duration != 30 {
		t.Fatalf("recipe %+v", o)
	}
}

func TestOverlayPartWeight(t *testing.T) {
	p := overlayPart{Start: 2, Duration: 4, FadeIn: 0.4, FadeOut: 1}
	for _, c := range []struct{ at, want float64 }{{1.9, 0}, {2.2, 0.5}, {4, 1}, {5.5, 0.5}, {6.1, 0}} {
		if got := p.weight(c.at); math.Abs(got-c.want) > 1e-9 {
			t.Fatalf("weight(%v) = %v, want %v", c.at, got, c.want)
		}
	}
}

func TestOverlayRecipeRoundTrip(t *testing.T) {
	avatar := image.NewRGBA(image.Rect(0, 0, 8, 8))
	avatar.Pix[3] = 255
	c := captionCard{name: "d1ledez", team: "Norsk Tipping", opponent: "BETBOOM", mapName: "Inferno", round: 7, kind: "4K", avatar: avatar}
	o := clipOverlay(1280, 720, true, []float64{12}, []overlayPart{{Card: specOf(c), Feed: []feedKill{{At: 3, Killer: "d1ledez", Victim: "x", Weapon: "AK-47", Own: true}}}})
	path := filepath.Join(t.TempDir(), "clip.overlay.json")
	if err := o.save(path); err != nil {
		t.Fatal(err)
	}
	back, err := loadOverlay(path)
	if err != nil {
		t.Fatal(err)
	}
	got := back.Parts[0].Card.card()
	if got.name != c.name || got.team != c.team || got.round != 7 || got.avatar == nil || got.avatar.Bounds().Dx() != 8 {
		t.Fatalf("card %+v", got)
	}
	if f := back.Parts[0].Feed; len(f) != 1 || f[0].Weapon != "AK-47" || !f[0].Own {
		t.Fatalf("feed %+v", f)
	}
	// The card draws from it, entrance and all.
	track, err := newOverlayTrack(back, nil)
	if err != nil {
		t.Fatal(err)
	}
	if track.cardBox.Empty() || len(track.cardFrame(2)) != track.cardBox.Dx()*track.cardBox.Dy()*4 {
		t.Fatalf("card box %v", track.cardBox)
	}
	lit := 0
	for i := 3; i < len(track.cardFrame(2)); i += 4 {
		if track.cardFrame(2)[i] > 0 {
			lit++
			break
		}
	}
	if lit == 0 {
		t.Fatal("nothing drawn at 2 s")
	}
	if cleanPathOf("/x/12.mp4") != "/x/12.clean.mp4" || overlayPathOf("/x/reel-a.mp4") != "/x/reel-a.overlay.json" {
		t.Fatal("twin paths")
	}
}
