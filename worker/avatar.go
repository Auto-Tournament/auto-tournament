package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"math"
)

// roundAvatarImage is roundAvatar as an image.
func roundAvatarImage(src []byte) (image.Image, error) {
	b, err := roundAvatar(src)
	if err != nil {
		return nil, err
	}
	return png.Decode(bytes.NewReader(b))
}

// roundAvatar cuts the middle square of an image (JPEG, PNG or GIF) into a
// circle with soft edges, as a PNG; ffmpeg scales it for the caption.
func roundAvatar(src []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, fmt.Errorf("avatar: %w", err)
	}
	b := img.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	if side < 8 {
		return nil, fmt.Errorf("avatar: %dx%d is too small", b.Dx(), b.Dy())
	}
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	out := image.NewNRGBA(image.Rect(0, 0, side, side))
	r := float64(side) / 2
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			d := math.Hypot(float64(x)+0.5-r, float64(y)+0.5-r)
			// Full inside, fading over the last pixel.
			cover := math.Max(0, math.Min(1, r-d))
			if cover == 0 {
				continue
			}
			c := color.NRGBAModel.Convert(img.At(x0+x, y0+y)).(color.NRGBA)
			c.A = uint8(float64(c.A) * cover)
			out.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
