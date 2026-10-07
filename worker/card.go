package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// The site's type (assets/fonts, SIL Open Font License): Sora for names,
// Geist for the rest.
var (
	//go:embed assets/fonts/Sora-Bold.ttf
	soraBold []byte
	//go:embed assets/fonts/Geist-Medium.ttf
	geistMedium []byte
	//go:embed assets/fonts/Geist-Regular.ttf
	geistRegular []byte
)

// The site's colours (client/src/theme/tokens.ts, the dark theme).
var (
	cardPaper  = color.NRGBA{0x18, 0x11, 0x0e, 0xe6} // paper2, 90 %
	cardRule   = color.NRGBA{0x32, 0x29, 0x26, 0xff}
	cardInk    = color.NRGBA{0xf4, 0xed, 0xeb, 0xff}
	cardInk2   = color.NRGBA{0xc4, 0xbc, 0xb9, 0xff}
	cardMuted  = color.NRGBA{0x93, 0x8a, 0x87, 0xff}
	cardAccent = color.NRGBA{0xff, 0x6a, 0x3d, 0xff}
)

// captionCard is the lower-left card of a clip: the player's avatar and name,
// the moment, and the match.
type captionCard struct {
	name, moment, match string
	avatar              image.Image // round, or nil
}

func face(ttf []byte, size float64) (font.Face, error) {
	f, err := opentype.Parse(ttf)
	if err != nil {
		return nil, err
	}
	return opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
}

// render draws the card for a video `videoHeight` pixels tall, as a PNG.
func (c captionCard) render(videoHeight int) ([]byte, error) {
	k := float64(videoHeight) / 1440
	px := func(v float64) int { return int(math.Round(v * k)) }
	nameFace, err := face(soraBold, 54*k)
	if err != nil {
		return nil, err
	}
	momentFace, err := face(geistMedium, 34*k)
	if err != nil {
		return nil, err
	}
	matchFace, err := face(geistRegular, 28*k)
	if err != nil {
		return nil, err
	}
	type line struct {
		text string
		face font.Face
		ink  color.NRGBA
		gap  int // space above
	}
	lines := []line{{c.name, nameFace, cardInk, 0}}
	if c.moment != "" {
		lines = append(lines, line{c.moment, momentFace, cardInk2, px(10)})
	}
	if c.match != "" {
		lines = append(lines, line{c.match, matchFace, cardMuted, px(8)})
	}
	textW, textH := 0, 0
	for _, l := range lines {
		if w := font.MeasureString(l.face, l.text).Ceil(); w > textW {
			textW = w
		}
		textH += l.gap + l.face.Metrics().Height.Ceil()
	}
	pad, gap, avatar := px(30), px(26), 0
	if c.avatar != nil {
		avatar = px(118)
	}
	inner := textH
	if avatar > inner {
		inner = avatar
	}
	w := pad + textW + pad
	if avatar > 0 {
		w += avatar + gap
	}
	h := pad + inner + pad
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	radius := float64(px(26))
	border := math.Max(1, 2*k)
	// The card: a rounded rectangle with a hairline border, anti-aliased.
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			d := roundedDistance(float64(x)+0.5, float64(y)+0.5, float64(w), float64(h), radius)
			outer := clamp01(-d + 0.5)
			if outer == 0 {
				continue
			}
			fill := clamp01(-d - border + 0.5)
			col := blend(cardRule, cardPaper, fill)
			col.A = uint8(float64(col.A) * outer)
			img.SetNRGBA(x, y, col)
		}
	}
	x := pad
	if c.avatar != nil {
		ay := (h - avatar) / 2
		draw.CatmullRom.Scale(img, image.Rect(x, ay, x+avatar, ay+avatar), c.avatar, c.avatar.Bounds(), draw.Over, nil)
		// A thin accent ring around it.
		ring(img, x+avatar/2, ay+avatar/2, float64(avatar)/2, math.Max(1.5, 3*k), cardAccent)
		x += avatar + gap
	}
	y := (h - textH) / 2
	for _, l := range lines {
		y += l.gap
		m := l.face.Metrics()
		d := &font.Drawer{Dst: img, Src: image.NewUniform(l.ink), Face: l.face,
			Dot: fixed.P(x, y+m.Ascent.Ceil())}
		d.DrawString(l.text)
		y += m.Height.Ceil()
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("caption card: %w", err)
	}
	return buf.Bytes(), nil
}

// roundedDistance is the signed distance from (x, y) to the edge of a w×h
// rectangle with corners of radius r (negative inside).
func roundedDistance(x, y, w, h, r float64) float64 {
	qx := math.Abs(x-w/2) - (w/2 - r)
	qy := math.Abs(y-h/2) - (h/2 - r)
	outside := math.Hypot(math.Max(qx, 0), math.Max(qy, 0))
	return outside + math.Min(math.Max(qx, qy), 0) - r
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// blend is a over b by t (0: b, 1: a), alpha included.
func blend(a, b color.NRGBA, t float64) color.NRGBA {
	mix := func(p, q uint8) uint8 { return uint8(math.Round(float64(p)*(1-t) + float64(q)*t)) }
	return color.NRGBA{mix(a.R, b.R), mix(a.G, b.G), mix(a.B, b.B), mix(a.A, b.A)}
}

// ring draws a circle outline of width `width` around (cx, cy).
func ring(img *image.NRGBA, cx, cy int, r, width float64, col color.NRGBA) {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			d := math.Abs(math.Hypot(float64(x-cx)+0.5, float64(y-cy)+0.5) - r)
			a := clamp01(width/2 - d + 0.5)
			if a == 0 {
				continue
			}
			under := img.NRGBAAt(x, y)
			c := blend(under, col, a)
			c.A = uint8(math.Max(float64(under.A), 255*a))
			img.SetNRGBA(x, y, c)
		}
	}
}
