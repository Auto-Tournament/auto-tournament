package main

// A reel's intro (the drafts' "A · Centred"): what the reel is from, over a
// grid of its own clips (blurred, darkened by 75 % and in slow motion; see
// reel.go). A kicker ("MATCH HIGHLIGHTS"), the title, an orange rule, the
// details and the date, and "Played on Auto Tournament" with the logo at the
// bottom. The text comes in line by line and lifts away at the end, as the
// orange wipe takes the reel to its first clip.

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"unicode/utf8"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/math/fixed"
)

// reelIntro is the intro's text, from the platform (or the worker, for a
// player's reel). An empty Title means no intro.
type reelIntro struct {
	Kicker string `json:"kicker"` // "Match highlights"
	Title  string `json:"title"`  // "9z vs BETBOOM"
	Meta   string `json:"meta"`   // "ESL Pro League Season 24 · Semi-final"
	Map    string `json:"map"`    // "de_dust2": shown before the date
	Date   string `json:"date"`   // "7 October 2026"
}

// introSec is how long the intro runs before the wipe ends it; introOutSec is
// the lift at its end.
const (
	introSec    = 4.4
	introOutSec = 0.35
)

// introRender holds the intro's parts, drawn once.
type introRender struct {
	w, h    int
	k       float64 // pixels per draft pixel (the drafts are 1280×720)
	kicker  *image.RGBA
	title   *image.RGBA
	meta    *image.RGBA
	played  *image.RGBA
	ruleW   int
	ruleH   int
	gap     int
	stackY  int // the stack's top
	playedY int
	frame   *image.RGBA
}

var introAccent = color.NRGBA{0xff, 0x6a, 0x3d, 0xff}

// layout draws the intro's parts for a w×h video.
func (in reelIntro) layout(w, h int) (*introRender, error) {
	k := float64(h) / 720
	px := func(v float64) int { return int(math.Round(v * k)) }
	kickerFace, err := face(geistMonoMedium, 17*k)
	if err != nil {
		return nil, err
	}
	titleSize := 72.0
	if n := utf8.RuneCountInString(in.Title); n > 22 {
		// Long names get smaller rather than leaving the frame.
		titleSize = math.Max(44, 72*22/float64(n))
	}
	titleFace, err := face(soraBold, titleSize*k)
	if err != nil {
		return nil, err
	}
	metaFace, err := face(geistMedium, 20*k)
	if err != nil {
		return nil, err
	}
	playedFace, err := face(geistRegular, 16*k)
	if err != nil {
		return nil, err
	}
	playedBold, err := face(geistMedium, 16*k)
	if err != nil {
		return nil, err
	}

	r := &introRender{w: w, h: h, k: k, ruleW: px(154), ruleH: max(2, px(4)), gap: px(18)}
	r.kicker = textImage([]textRun{{strings.ToUpper(in.Kicker), kickerFace, introAccent}}, 0.22*17*k)
	r.title = textImage([]textRun{{in.Title, titleFace, cardInk}}, -0.02*titleSize*k)
	var metaLines []*image.RGBA
	for _, line := range []string{in.Meta, joinDot(mapDisplayName(in.Map), in.Date)} {
		if strings.TrimSpace(line) != "" {
			metaLines = append(metaLines, textImage([]textRun{{line, metaFace, cardInk2}}, 0))
		}
	}
	r.meta = stackCentered(metaLines, px(4))

	// "Played on Auto Tournament" with the logo before it.
	logo, err := png.Decode(bytes.NewReader(watermarkPNG))
	if err != nil {
		return nil, err
	}
	words := textImage([]textRun{{"Played on ", playedFace, cardInk2}, {"Auto Tournament", playedBold, cardInk}}, 0)
	size := px(28)
	r.played = image.NewRGBA(image.Rect(0, 0, size+px(12)+words.Bounds().Dx(), max(size, words.Bounds().Dy())))
	draw.CatmullRom.Scale(r.played, image.Rect(0, (r.played.Bounds().Dy()-size)/2, size, (r.played.Bounds().Dy()-size)/2+size), logo, logo.Bounds(), draw.Over, nil)
	draw.Draw(r.played, image.Rect(size+px(12), (r.played.Bounds().Dy()-words.Bounds().Dy())/2, r.played.Bounds().Dx(), r.played.Bounds().Dy()), words, image.Point{}, draw.Over)

	stackH := r.kicker.Bounds().Dy() + r.gap + r.title.Bounds().Dy() + r.gap + r.ruleH + r.gap + r.meta.Bounds().Dy()
	r.stackY = (h - stackH) / 2
	r.playedY = h - px(64) - r.played.Bounds().Dy()
	r.frame = image.NewRGBA(image.Rect(0, 0, w, h))
	return r, nil
}

type textRun struct {
	s    string
	face font.Face
	ink  color.NRGBA
}

// textImage draws runs of text on one line, `track` pixels between letters.
func textImage(runs []textRun, track float64) *image.RGBA {
	width, ascent, descent := 0.0, 0, 0
	for _, run := range runs {
		m := run.face.Metrics()
		ascent, descent = max(ascent, m.Ascent.Ceil()), max(descent, m.Descent.Ceil())
		for _, ch := range run.s {
			a, _ := run.face.GlyphAdvance(ch)
			width += float64(a.Ceil()) + track
		}
	}
	width -= track
	img := image.NewRGBA(image.Rect(0, 0, max(1, int(math.Ceil(width))+2), ascent+descent))
	x := 1.0
	for _, run := range runs {
		for _, ch := range run.s {
			(&font.Drawer{Dst: img, Src: image.NewUniform(run.ink), Face: run.face, Dot: fixed.P(int(math.Round(x)), ascent)}).DrawString(string(ch))
			a, _ := run.face.GlyphAdvance(ch)
			x += float64(a.Ceil()) + track
		}
	}
	return img
}

// stackCentered puts images under each other, centred, `gap` apart.
func stackCentered(parts []*image.RGBA, gap int) *image.RGBA {
	w, h := 1, 0
	for i, p := range parts {
		w = max(w, p.Bounds().Dx())
		h += p.Bounds().Dy()
		if i > 0 {
			h += gap
		}
	}
	out := image.NewRGBA(image.Rect(0, 0, w, max(1, h)))
	y := 0
	for _, p := range parts {
		x := (w - p.Bounds().Dx()) / 2
		draw.Draw(out, image.Rect(x, y, x+p.Bounds().Dx(), y+p.Bounds().Dy()), p, image.Point{}, draw.Over)
		y += p.Bounds().Dy() + gap
	}
	return out
}

// easeOut is the drafts' cubic-bezier(.2,.8,.2,1), near enough.
func easeOut(t float64) float64 {
	t = clamp01(t)
	return 1 - math.Pow(1-t, 3)
}

// phase is how far (0..1) an animation that starts at `from` and runs `dur` is at t.
func phase(t, from, dur float64) float64 { return clamp01((t - from) / dur) }

// Frames is how many frames the intro streams at cardFPS.
func (r *introRender) Frames() int { return int(math.Ceil(introSec * cardFPS)) }

// frameAt draws the intro `t` seconds in: full-frame premultiplied RGBA, the
// text only (the grid under it is ffmpeg's).
func (r *introRender) frameAt(t float64) *image.RGBA {
	clear(r.frame.Pix)
	// The lift at the end: everything rises a little and fades.
	out := phase(t, introSec-introOutSec, introOutSec)
	outLift, outAlpha := -26*r.k*out*out, 1-out
	y := r.stackY

	// Kicker: up and in, 0.35 s for 0.5 s.
	p := easeOut(phase(t, 0.35, 0.5))
	r.place(r.kicker, y, 20*r.k*(1-p)+outLift, p*outAlpha, 1)
	y += r.kicker.Bounds().Dy() + r.gap

	// Title: revealed from the top down while it rises, 0.55 s for 0.7 s.
	p = easeOut(phase(t, 0.55, 0.7))
	r.place(r.title, y, 26*r.k*(1-p)+outLift, outAlpha, p)
	y += r.title.Bounds().Dy() + r.gap

	// The orange rule grows from the middle, 1.05 s for 0.6 s.
	p = easeOut(phase(t, 1.05, 0.6))
	if rw := int(float64(r.ruleW) * p); rw > 0 && outAlpha > 0 {
		x0 := (r.w - rw) / 2
		ry := y + int(outLift)
		rad := float64(r.ruleH) / 2
		for yy := 0; yy < r.ruleH; yy++ {
			for xx := 0; xx < rw; xx++ {
				d := roundedDistance(float64(xx)+0.5, float64(yy)+0.5, float64(rw), float64(r.ruleH), rad)
				over(r.frame, x0+xx, ry+yy, introAccent, clamp01(0.5-d)*outAlpha)
			}
		}
	}
	y += r.ruleH + r.gap

	// Details and date, 0.95 s for 0.5 s.
	p = easeOut(phase(t, 0.95, 0.5))
	r.place(r.meta, y, 20*r.k*(1-p)+outLift, p*outAlpha, 1)

	// "Played on Auto Tournament": fades in at 1.4 s.
	p = phase(t, 1.4, 0.6)
	r.place(r.played, r.playedY, outLift, p*outAlpha, 1)
	return r.frame
}

// place draws img centred at row y (+dy), at alpha, showing its top `reveal` part.
func (r *introRender) place(img *image.RGBA, y int, dy, alpha, reveal float64) {
	if alpha <= 0 || reveal <= 0 {
		return
	}
	b := img.Bounds()
	x0 := (r.w - b.Dx()) / 2
	y0 := y + int(math.Round(dy))
	rows := int(math.Ceil(float64(b.Dy()) * reveal))
	for yy := 0; yy < rows; yy++ {
		ty := y0 + yy
		if ty < 0 || ty >= r.h {
			continue
		}
		for xx := 0; xx < b.Dx(); xx++ {
			tx := x0 + xx
			if tx < 0 || tx >= r.w {
				continue
			}
			s := img.RGBAAt(xx, yy)
			if s.A == 0 {
				continue
			}
			// img is premultiplied: scale it by alpha and draw it over.
			i := r.frame.PixOffset(tx, ty)
			sa := float64(s.A) * alpha
			inv := 1 - sa/255
			r.frame.Pix[i] = uint8(float64(s.R)*alpha + float64(r.frame.Pix[i])*inv)
			r.frame.Pix[i+1] = uint8(float64(s.G)*alpha + float64(r.frame.Pix[i+1])*inv)
			r.frame.Pix[i+2] = uint8(float64(s.B)*alpha + float64(r.frame.Pix[i+2])*inv)
			r.frame.Pix[i+3] = uint8(sa + float64(r.frame.Pix[i+3])*inv)
		}
	}
}
