package main

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"testing"
)

func TestCaptionCardRenders(t *testing.T) {
	icon, err := os.ReadFile("assets/watermark.png")
	if err != nil {
		t.Fatal(err)
	}
	round, err := roundAvatar(icon)
	if err != nil {
		t.Fatal(err)
	}
	av, _, err := image.Decode(bytes.NewReader(round))
	if err != nil {
		t.Fatal(err)
	}
	out, err := captionCard{name: "Goggles", moment: "2 kills · Glock-18 · round 2", match: "Sim Echo vs Sim Foxtrot · NTLAN Test Cup", avatar: av}.render(1440)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	if b.Dx() < 400 || b.Dy() < 150 || b.Dx() > 1600 {
		t.Fatalf("card is %v", b)
	}
	// Rounded: the corner is clear, the middle of the edge is not.
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatal("corner should be clear")
	}
	if _, _, _, a := img.At(b.Dx()/2, 1).RGBA(); a == 0 {
		t.Fatal("top edge should be drawn")
	}
	if dir := os.Getenv("CARD_OUT"); dir != "" {
		_ = os.WriteFile(dir+"/card.png", out, 0o644)
	}
}
