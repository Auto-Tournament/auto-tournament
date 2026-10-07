package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestRoundAvatarCutsACircle(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			src.Set(x, y, color.RGBA{200, 50, 50, 255})
		}
	}
	var in bytes.Buffer
	_ = png.Encode(&in, src)
	out, err := roundAvatar(in.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 48 || b.Dy() != 48 {
		t.Fatalf("not the middle square: %v", b)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatal("corner should be clear")
	}
	if _, _, _, a := img.At(24, 24).RGBA(); a != 0xffff {
		t.Fatal("middle should be solid")
	}
}

func TestRoundAvatarRejectsJunk(t *testing.T) {
	if _, err := roundAvatar([]byte("not an image")); err == nil {
		t.Fatal("junk should fail")
	}
}
