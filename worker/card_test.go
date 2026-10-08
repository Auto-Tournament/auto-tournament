package main

import (
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"testing"
)

func TestCaptionCardAnimates(t *testing.T) {
	c := captionCard{name: "d1Ledez", teams: "9z vs BETBOOM", mapName: mapDisplayName("de_dust2"), round: 2, kind: "4K",
		tag: cornerTag("NTLAN Autumn Cup", "Semi-final")}
	r, err := c.layout(2560, 1440)
	if err != nil {
		t.Fatal(err)
	}
	if r.region.Min.X%2 != 0 || r.region.Min.Y%2 != 0 || r.region.Dx()%2 != 0 || r.region.Dy()%2 != 0 {
		t.Fatalf("region %v is not even", r.region)
	}
	if !r.region.In(image.Rect(0, 0, 2560, 1440)) {
		t.Fatalf("region %v is off the video", r.region)
	}
	alphaAt := func(f *image.RGBA, p image.Point) uint8 { return f.RGBAAt(p.X, p.Y).A }
	mid := image.Pt((r.card.Min.X+r.card.Max.X)/2, (r.card.Min.Y+r.card.Max.Y)/2)
	if a := alphaAt(r.frameAt(0), mid); a != 0 {
		t.Fatalf("card shows before it starts (alpha %d)", a)
	}
	if a := alphaAt(r.frameAt(2), mid); a < 200 {
		t.Fatalf("card not up at 2 s (alpha %d)", a)
	}
	// At the end it is small, at the bottom centre, a little see-through
	// (cardSettledOpacity), and stays: the settled card (a clip's later
	// pieces) is the same picture.
	small := image.Pt((r.small.Min.X+r.small.Max.X)/2, (r.small.Min.Y+r.small.Max.Y)/2)
	end := alphaAt(r.frameAt(cardSec), small)
	if full := alphaAt(r.frameAt(2), mid); math.Abs(float64(end)-float64(full)*cardSettledOpacity) > 12 {
		t.Fatalf("card not at the bottom centre at %v opacity at the end (alpha %d, open %d)", cardSettledOpacity, end, full)
	}
	if r.small.Dx() >= r.card.Dx() || r.small.Max.Y <= r.card.Max.Y {
		t.Fatalf("small card %v is not smaller and lower than %v", r.small, r.card)
	}
	if a := alphaAt(r.Settled().frameAt(0), small); a != end {
		t.Fatalf("settled card missing (alpha %d)", a)
	}
	if dir := os.Getenv("CARD_OUT"); dir != "" {
		for _, at := range []float64{0.3, 0.6, 1.0, 2.0, 3.3, 3.6, 3.85} {
			f, _ := os.Create(fmt.Sprintf("%s/card-%.2f.png", dir, at))
			_ = png.Encode(f, r.frameAt(at))
			f.Close()
		}
		fmt.Printf("region %v\n", r.region)
		// Every frame at 720p, for a preview video.
		small, err := c.layout(1280, 720)
		if err != nil {
			t.Fatal(err)
		}
		_ = os.MkdirAll(dir+"/frames", 0o755)
		for i := 0; i < int(cardSec*cardFPS); i++ {
			f, _ := os.Create(fmt.Sprintf("%s/frames/%04d.png", dir, i))
			_ = png.Encode(f, small.frameAt(float64(i)/cardFPS))
			f.Close()
		}
		fmt.Printf("small region %v\n", small.region)
	}
}

func TestPillLabelAndNames(t *testing.T) {
	for _, c := range [][3]string{
		{"ace", "Ace · AK-47 · round 3", "ACE"},
		{"4k", "4 kills · M4A1-S · round 2", "4K"},
		{"3k", "3 kills clutch · AWP · round 9", "3K"},
		{"clutch", "1 kill clutch · round 4", "CLUTCH"},
		{"flair", "1 kill · AWP · round 1", ""},
	} {
		if got := pillLabel(c[0], c[1]); got != c[2] {
			t.Errorf("pillLabel(%q) = %q, want %q", c[0], got, c[2])
		}
	}
	if got := mapDisplayName("de_dust2"); got != "Dust2" {
		t.Errorf("mapDisplayName = %q", got)
	}
	if got := initial("_d1Ledez"); got != "D" {
		t.Errorf("initial = %q", got)
	}
	if got := cornerTag("NTLAN Autumn Cup", ""); got != "NTLAN AUTUMN CUP" {
		t.Errorf("cornerTag = %q", got)
	}
}
