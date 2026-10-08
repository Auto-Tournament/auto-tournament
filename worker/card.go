package main

import (
	_ "embed"
	"image"
	"image/color"
	"math"
	"strings"
	"unicode"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// The site's type (assets/fonts, SIL Open Font License): Sora for names,
// Geist for the rest, Geist Mono for the corner tag.
var (
	//go:embed assets/fonts/Sora-Bold.ttf
	soraBold []byte
	//go:embed assets/fonts/Geist-Medium.ttf
	geistMedium []byte
	//go:embed assets/fonts/Geist-Regular.ttf
	geistRegular []byte
	//go:embed assets/fonts/GeistMono-Medium.ttf
	geistMonoMedium []byte
)

// The site's colours (client/src/theme/tokens.ts, the dark theme).
var (
	cardPaper  = color.NRGBA{0x14, 0x0d, 0x0b, 0xdb} // 86 %
	cardEdge   = color.NRGBA{0xf4, 0xed, 0xeb, 0x1f} // ink at 12 %
	cardInk    = color.NRGBA{0xf4, 0xed, 0xeb, 0xff}
	cardInk2   = color.NRGBA{0xc4, 0xbc, 0xb9, 0xff}
	cardAccent = color.NRGBA{0xff, 0x6a, 0x3d, 0xff}
	accentInk  = color.NRGBA{0x14, 0x0e, 0x0c, 0xff}
	avatarBack = color.NRGBA{0x2a, 0x1a, 0x14, 0xff}
	tagInk     = color.NRGBA{0xf4, 0xed, 0xeb, 0xff}
	tagInk2    = color.NRGBA{0xc4, 0xbc, 0xb9, 0xff}
	tagPlate   = color.NRGBA{0x14, 0x0d, 0x0b, 0xb8} // the card's paper at 72 %
)

// captionCard is what a clip opens with (the drafts' "A smooth"): a card in
// the lower middle with the player's avatar, their name, the match, map and
// round, and what the moment is (4K, ACE…); and the tournament in a small
// tag in the lower left.
type captionCard struct {
	name    string
	teams   string // "9z vs BETBOOM"
	mapName string // "Dust2"
	round   int    // 0: unknown
	kind    string // the pill: "4K", "ACE"; "" for none
	tag     string // "NTLAN AUTUMN CUP · SEMI-FINAL"; "" for none
	avatar  image.Image
}

// The card's timing, in seconds of the clip. The clip plays slowed down while
// the card is up and speeds back up to full speed as it leaves (cardExit).
const (
	cardSec  = 4.0
	cardExit = 3.2
)

// cardCorner is the card's corner radius in the drafts' pixels (540p).
var cardCorner = 16.0

// cardFPS is how often the card's frames change; ffmpeg repeats each for the
// video's 120.
const cardFPS = 60

func face(ttf []byte, size float64) (font.Face, error) {
	f, err := opentype.Parse(ttf)
	if err != nil {
		return nil, err
	}
	return opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
}

// cardRender holds the card's parts, drawn once, and lays them out for any
// moment of the animation.
type cardRender struct {
	region image.Rectangle // where the frames go in the video
	card   image.Rectangle // the card, in region coordinates
	tag    image.Rectangle // the tag, in region coordinates
	k      float64         // pixels per draft pixel at 1440p
	radius float64

	back   *image.RGBA // the card's fill and edge
	barH   int         // the accent line along its bottom
	avatar *image.RGBA
	text   *image.RGBA
	pill   *image.RGBA // nil without a kind
	tagImg *image.RGBA // nil without a tag
	// Where each sits in the card.
	avatarAt, textAt, pillAt image.Point

	scratch *image.RGBA // the card, composed for one frame
	frame   *image.RGBA

	// After its entrance the card shrinks to `small` (bottom centre, region
	// coordinates) and stays there for the rest of the clip.
	small image.Rectangle
	// settled renders only that last state: the clip's later pieces (after
	// a jump cut) keep the small card without playing the entrance again.
	settled bool
	full    *image.RGBA // the open card's name, avatar and pill, once composed
	plate   *image.RGBA // its plate with the rounded edge, drawn see-through when settled
}

// cardSmall is how big the card is once it has moved to the bottom centre.
const cardSmall = 0.6

// Settled is the same card in its last state only, for a clip's later pieces.
func (r *cardRender) Settled() *cardRender {
	c := *r
	c.settled = true
	c.frame = image.NewRGBA(r.frame.Bounds())
	return &c
}

// Frames is how many frames to stream: the whole animation, or one settled
// frame (ffmpeg repeats the last frame to the end of the piece).
func (r *cardRender) Frames() int {
	if r.settled {
		return 1
	}
	return int(cardSec * cardFPS)
}

// layout draws the parts for a video w×h.
func (c captionCard) layout(w, h int) (*cardRender, error) {
	k := float64(h) / 1440 * (1440.0 / 540) // the drafts are 540 tall
	px := func(v float64) int { return int(math.Round(v * k)) }
	nameFace, err := face(soraBold, 22*k)
	if err != nil {
		return nil, err
	}
	subFace, err := face(geistRegular, 13*k)
	if err != nil {
		return nil, err
	}
	pillFace, err := face(soraBold, 18*k)
	if err != nil {
		return nil, err
	}
	tagFace, err := face(geistMonoMedium, 13*k)
	if err != nil {
		return nil, err
	}

	r := &cardRender{k: k, radius: cardCorner * k}

	// The avatar: theirs in an accent ring, or their initial on the same ring.
	av := px(48)
	r.avatar = image.NewRGBA(image.Rect(0, 0, av, av))
	disc(r.avatar, float64(av)/2, avatarBack)
	if c.avatar != nil {
		inner := av - 2*px(2)
		draw.CatmullRom.Scale(r.avatar, image.Rect(px(2), px(2), px(2)+inner, px(2)+inner), c.avatar, c.avatar.Bounds(), draw.Over, nil)
	} else if i := initial(c.name); i != "" {
		f, err := face(soraBold, 20*k)
		if err != nil {
			return nil, err
		}
		tw := font.MeasureString(f, i).Ceil()
		m := f.Metrics()
		d := &font.Drawer{Dst: r.avatar, Src: image.NewUniform(cardAccent), Face: f,
			Dot: fixed.P((av-tw)/2, (av+m.Ascent.Ceil()-m.Descent.Ceil())/2)}
		d.DrawString(i)
	}
	ringRGBA(r.avatar, float64(av)/2, math.Max(1.5, 2*k), cardAccent)

	// The text: the name, and the teams under it (the map and round are in the corner).
	type run struct {
		s   string
		f   font.Face
		ink color.NRGBA
	}
	var sub []run
	if c.teams != "" {
		sub = append(sub, run{c.teams, subFace, cardInk2})
	}
	nameW := font.MeasureString(nameFace, c.name).Ceil()
	subW := 0
	for _, s := range sub {
		subW += font.MeasureString(s.f, s.s).Ceil()
	}
	nm, sm := nameFace.Metrics(), subFace.Metrics()
	nameH := int(math.Round(22 * 1.1 * k))
	textW := max(nameW, subW)
	textH := nameH + px(3) + sm.Height.Ceil()
	r.text = image.NewRGBA(image.Rect(0, 0, textW+px(2), textH))
	(&font.Drawer{Dst: r.text, Src: image.NewUniform(cardInk), Face: nameFace,
		Dot: fixed.P(0, (nameH+nm.Ascent.Ceil()-nm.Descent.Ceil())/2)}).DrawString(c.name)
	x := 0
	for _, s := range sub {
		d := &font.Drawer{Dst: r.text, Src: image.NewUniform(s.ink), Face: s.f,
			Dot: fixed.P(x, nameH+px(3)+sm.Ascent.Ceil())}
		d.DrawString(s.s)
		x += font.MeasureString(s.f, s.s).Ceil()
	}

	// The pill: 4K, ACE…
	pillW := 0
	if c.kind != "" {
		tw := font.MeasureString(pillFace, c.kind).Ceil()
		pm := pillFace.Metrics()
		pw, ph := tw+2*px(10), px(18)+2*px(6)
		r.pill = image.NewRGBA(image.Rect(0, 0, pw, ph))
		roundRect(r.pill, float64(pw), float64(ph), math.Min(10, cardCorner*10/16)*k, cardAccent, cardAccent, 0)
		(&font.Drawer{Dst: r.pill, Src: image.NewUniform(accentInk), Face: pillFace,
			Dot: fixed.P(px(10), (ph+pm.CapHeight.Ceil())/2)}).DrawString(c.kind)
		pillW = px(6) + pw
	}

	// The card around them.
	padL, padR, padY, gap := px(12), px(18), px(12), px(14)
	inner := max(av, textH)
	if r.pill != nil {
		inner = max(inner, r.pill.Bounds().Dy())
	}
	cw := padL + av + gap + textW + pillW + padR
	ch := padY + inner + padY
	r.avatarAt = image.Pt(padL, (ch-av)/2)
	r.textAt = image.Pt(padL+av+gap, (ch-textH)/2)
	if r.pill != nil {
		r.pillAt = image.Pt(padL+av+gap+textW+px(6), (ch-r.pill.Bounds().Dy())/2)
	}
	r.back = image.NewRGBA(image.Rect(0, 0, cw, ch))
	for y := 0; y < ch; y++ {
		for x := 0; x < cw; x++ {
			d := roundedDistance(float64(x)+0.5, float64(y)+0.5, float64(cw), float64(ch), r.radius)
			outer := clamp01(-d + 0.5)
			over(r.back, x, y, cardPaper, outer)
			over(r.back, x, y, cardEdge, outer*(1-clamp01(-d-math.Max(1, k)+0.5)))
		}
	}
	r.barH = int(math.Max(2, math.Round(3*k)))

	// The corner, lower left: the map and round, and under it a dot and the
	// tournament.
	type tagRun struct {
		s   string
		ink color.NRGBA
	}
	var lines [][]tagRun
	if c.mapName != "" || c.round > 0 {
		var l []tagRun
		if c.mapName != "" {
			l = append(l, tagRun{strings.ToUpper(c.mapName), tagInk})
		}
		if c.round > 0 {
			if len(l) > 0 {
				l = append(l, tagRun{" · ", tagInk})
			}
			l = append(l, tagRun{"ROUND " + itoa(c.round), cardInk})
		}
		lines = append(lines, l)
	}
	if c.tag != "" {
		lines = append(lines, []tagRun{{c.tag, tagInk2}})
	}
	tagW, tagH := 0, 0
	if len(lines) > 0 {
		tm := tagFace.Metrics()
		track := 0.1 * 13 * k
		dot := px(6)
		indent := dot + px(8)
		lineH, lineGap := max(tm.Height.Ceil(), dot), px(4)
		widthOf := func(l []tagRun) int {
			w := 0
			for _, r := range l {
				for _, ch := range r.s {
					a, _ := tagFace.GlyphAdvance(ch)
					w += a.Ceil() + int(track)
				}
			}
			return w
		}
		for _, l := range lines {
			tagW = max(tagW, indent+widthOf(l))
		}
		tagH = len(lines)*lineH + (len(lines)-1)*lineGap
		// A dark plate behind it, so it reads on any map (thin grey letters
		// on bright sand did not).
		pad := px(10)
		r.tagImg = image.NewRGBA(image.Rect(0, 0, tagW+2*pad, tagH+2*pad))
		{
			w, h, rad := float64(tagW+2*pad), float64(tagH+2*pad), float64(px(10))
			for y := 0; y < tagH+2*pad; y++ {
				for x := 0; x < tagW+2*pad; x++ {
					d := roundedDistance(float64(x)+0.5, float64(y)+0.5, w, h, rad)
					over(r.tagImg, x, y, tagPlate, clamp01(0.5-d))
				}
			}
		}
		letters := image.NewRGBA(r.tagImg.Bounds())
		for i, l := range lines {
			top := pad + i*(lineH+lineGap)
			if i == len(lines)-1 {
				disc(letters.SubImage(image.Rect(pad, top+(lineH-dot)/2, pad+dot, top+(lineH-dot)/2+dot)).(*image.RGBA), float64(dot)/2, cardAccent)
			}
			x, base := pad+indent, top+(lineH+tm.CapHeight.Ceil())/2
			for _, run := range l {
				for _, ch := range run.s {
					(&font.Drawer{Dst: letters, Src: image.NewUniform(run.ink), Face: tagFace, Dot: fixed.P(x, base)}).DrawString(string(ch))
					a, _ := tagFace.GlyphAdvance(ch)
					x += a.Ceil() + int(track)
				}
			}
		}
		// A soft dark shadow under the letters as well.
		shadow := softShadow(letters, px(2), 0.8)
		draw.Draw(r.tagImg, r.tagImg.Bounds(), shadow, image.Point{}, draw.Over)
		draw.Draw(r.tagImg, r.tagImg.Bounds(), letters, image.Point{}, draw.Over)
		tagW, tagH = tagW+2*pad, tagH+2*pad
	}

	// Where it all goes: the card centred, its top 65 % down; the tag in the corner.
	cardTop := int(math.Round(float64(h) * 352 / 540))
	cardLeft := (w - cw) / 2
	margin := px(18)
	tagLeft, tagTop := margin-px(4), h-px(16)-tagH+px(4)
	left := cardLeft
	if r.tagImg != nil && tagLeft < left {
		left = tagLeft
	}
	right := cardLeft + cw
	if r.tagImg != nil && tagLeft+tagW+px(2) > right {
		right = tagLeft + tagW + px(2)
	}
	bottom := cardTop + ch + px(10) // it rises from this far below
	if r.tagImg != nil && tagTop+tagH+px(2) > bottom {
		bottom = tagTop + tagH + px(2)
	}
	// Where it ends up: smaller, centred, its bottom where the tag's is.
	sw, sh := int(math.Round(float64(cw)*cardSmall)), int(math.Round(float64(ch)*cardSmall))
	smallLeft, smallTop := (w-sw)/2, h-px(14)-sh
	if smallTop+sh+px(2) > bottom {
		bottom = smallTop + sh + px(2)
	}
	// Even sizes and positions for the yuv420 video.
	left, cardTop0 := left&^1, cardTop&^1
	r.region = image.Rect(left, cardTop0, (right+1)&^1, (bottom+1)&^1)
	r.card = image.Rect(cardLeft-left, cardTop-cardTop0, cardLeft-left+cw, cardTop-cardTop0+ch)
	r.tag = image.Rect(tagLeft-left, tagTop-cardTop0, tagLeft-left+tagW, tagTop-cardTop0+tagH)
	r.small = image.Rect(smallLeft-left, smallTop-cardTop0, smallLeft-left+sw, smallTop-cardTop0+sh)
	r.scratch = image.NewRGBA(image.Rect(0, 0, cw, ch))
	r.frame = image.NewRGBA(image.Rect(0, 0, r.region.Dx(), r.region.Dy()))
	return r, nil
}

// frameAt draws the card `t` seconds into the clip (premultiplied RGBA, the
// region's size). The same buffer is reused for every frame.
//
// The card opens from its middle, rising into place; its content comes in
// and the accent line draws across. Then, as the clip speeds up, it shrinks
// and glides to the bottom centre, where it stays to the end of the clip.
func (r *cardRender) frameAt(t float64) *image.RGBA {
	clear(r.frame.Pix)
	if r.settled {
		r.drawMoved(1)
		return r.frame
	}
	ease := func(from, to float64) float64 { return smooth(clamp01((t - from) / (to - from))) }
	if move := ease(3.3, 3.9); move > 0 {
		r.drawMoved(move)
	} else if unfold := ease(0.10, 0.75); unfold > 0 {
		r.compose(t, unfold)
		dy := int(math.Round(10 * r.k * (1 - unfold)))
		draw.DrawMask(r.frame, r.card.Add(image.Pt(0, dy)), r.scratch, image.Point{}, r.edgeMask(unfold), image.Point{}, draw.Over)
	}
	// The corner slides in from the left after the card, and back out as it moves.
	if r.tagImg != nil {
		if a := ease(0.85, 1.45) * (1 - ease(3.3, 3.75)); a > 0 {
			dx := int(math.Round(-16 * r.k * (1 - ease(0.85, 1.45) + ease(3.3, 3.75))))
			draw.DrawMask(r.frame, r.tagImg.Bounds().Add(r.tag.Min).Add(image.Pt(dx, 0)), r.tagImg, image.Point{},
				image.NewUniform(color.Alpha{uint8(255 * a)}), image.Point{}, draw.Over)
		}
	}
	return r.frame
}

// compose draws the card's content `t` seconds in onto the scratch image.
func (r *cardRender) compose(t, unfold float64) {
	r.composeLayers(t, unfold, true)
}

// composeLayers is compose with or without the card's plate (r.back).
func (r *cardRender) composeLayers(t, unfold float64, plate bool) {
	ease := func(from, to float64) float64 { return smooth(clamp01((t - from) / (to - from))) }
	s := r.scratch
	clear(s.Pix)
	cw, ch := s.Bounds().Dx(), s.Bounds().Dy()
	if plate {
		draw.Draw(s, s.Bounds(), r.back, image.Point{}, draw.Over)
	}
	// The avatar fades in growing a little.
	if a := ease(0.45, 0.95); a > 0 {
		scale := 0.85 + 0.15*a
		ab := r.avatar.Bounds()
		sw, sh := int(float64(ab.Dx())*scale), int(float64(ab.Dy())*scale)
		at := r.avatarAt.Add(image.Pt((ab.Dx()-sw)/2, (ab.Dy()-sh)/2))
		draw.ApproxBiLinear.Scale(s, image.Rect(at.X, at.Y, at.X+sw, at.Y+sh), r.avatar, ab, draw.Over,
			&draw.Options{SrcMask: image.NewUniform(color.Alpha{uint8(255 * a)})})
	}
	// The text slides in from the left.
	if a := ease(0.65, 1.2); a > 0 {
		dx := int(math.Round(-10 * r.k * (1 - a)))
		draw.DrawMask(s, r.text.Bounds().Add(r.textAt.Add(image.Pt(dx, 0))), r.text, image.Point{},
			image.NewUniform(color.Alpha{uint8(255 * a)}), image.Point{}, draw.Over)
	}
	// The pill wipes in from the left.
	if r.pill != nil {
		pb := r.pill.Bounds()
		if to := int(float64(pb.Dx()) * ease(0.9, 1.4)); to > 0 {
			part := image.Rect(0, 0, to, pb.Dy())
			draw.Draw(s, part.Add(r.pillAt), r.pill, part.Min, draw.Over)
		}
	}
	// The accent line draws across.
	if p := ease(0.6, 1.55); p > 0 {
		line := image.Rect(0, ch-r.barH, int(float64(cw)*p), ch)
		draw.Draw(s, line, image.NewUniform(premul(cardAccent, 1)), image.Point{}, draw.Over)
	}
}

// edgeMask is the card's rounded shape, opened `unfold` of the way from its middle.
func (r *cardRender) edgeMask(unfold float64) *image.Alpha {
	cw, ch := r.scratch.Bounds().Dx(), r.scratch.Bounds().Dy()
	mask := image.NewAlpha(image.Rect(0, 0, cw, ch))
	half := float64(cw) / 2 * unfold
	for y := 0; y < ch; y++ {
		for x := int(float64(cw)/2 - half - 1); x <= int(float64(cw)/2+half+1); x++ {
			if x < 0 || x >= cw {
				continue
			}
			d := roundedDistance(float64(x)+0.5-(float64(cw)/2-half), float64(y)+0.5, 2*half, float64(ch), math.Min(r.radius, half))
			if a := clamp01(-d + 0.5); a > 0 {
				mask.SetAlpha(x, y, color.Alpha{uint8(255 * a)})
			}
		}
	}
	return mask
}

// drawMoved draws the open card `move` of the way from its place to the
// small one. Its plate fades to cardSettledOpacity on the way, so the
// settled card stays out of the way; the name, avatar and pill stay solid,
// so it still reads.
func (r *cardRender) drawMoved(move float64) {
	if r.full == nil {
		mask := r.edgeMask(1)
		r.composeLayers(cardSec, 1, false)
		front := image.NewRGBA(r.scratch.Bounds())
		draw.DrawMask(front, front.Bounds(), r.scratch, image.Point{}, mask, image.Point{}, draw.Over)
		plate := image.NewRGBA(r.scratch.Bounds())
		draw.DrawMask(plate, plate.Bounds(), r.back, image.Point{}, mask, image.Point{}, draw.Over)
		r.full, r.plate = front, plate
	}
	lerp := func(a, b int) int { return int(math.Round(float64(a) + (float64(b)-float64(a))*move)) }
	at := image.Rect(lerp(r.card.Min.X, r.small.Min.X), lerp(r.card.Min.Y, r.small.Min.Y),
		lerp(r.card.Max.X, r.small.Max.X), lerp(r.card.Max.Y, r.small.Max.Y))
	opacity := 1 - (1-cardSettledOpacity)*move
	draw.CatmullRom.Scale(r.frame, at, r.plate, r.plate.Bounds(), draw.Over,
		&draw.Options{SrcMask: image.NewUniform(color.Alpha{uint8(math.Round(255 * opacity))})})
	draw.CatmullRom.Scale(r.frame, at, r.full, r.full.Bounds(), draw.Over, nil)
}

// cardSettledOpacity is how opaque the small card's plate is once it has moved down.
const cardSettledOpacity = 0.5

// smooth is the drafts' cubic-bezier(.2,.8,.2,1): quick out of the start, a long soft landing.
func smooth(t float64) float64 {
	if t <= 0 {
		return 0
	}
	if t >= 1 {
		return 1
	}
	// Solve x(u) = t for the curve's parameter, then y(u).
	bez := func(u, p1, p2 float64) float64 {
		v := 1 - u
		return 3*v*v*u*p1 + 3*v*u*u*p2 + u*u*u
	}
	lo, hi := 0.0, 1.0
	for i := 0; i < 30; i++ {
		mid := (lo + hi) / 2
		if bez(mid, 0.2, 0.2) < t {
			lo = mid
		} else {
			hi = mid
		}
	}
	return bez((lo+hi)/2, 0.8, 1)
}

// pillLabel is what a moment's pill says: ACE, 4K, CLUTCH; nothing for a
// single kill's flair.
func pillLabel(kind, title string) string {
	switch {
	case kind == "ace":
		return "ACE"
	case len(kind) == 2 && kind[1] == 'k' && kind[0] >= '2' && kind[0] <= '4':
		return strings.ToUpper(kind)
	case kind == "clutch" || strings.Contains(title, " clutch"):
		return "CLUTCH"
	case kind == "funny":
		return "OOPS"
	}
	return ""
}

// initial is the name's first letter or digit, for an avatar without a picture.
func initial(name string) string {
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return strings.ToUpper(string(r))
		}
	}
	return ""
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// premul is c at coverage a, premultiplied.
func premul(c color.NRGBA, a float64) color.RGBA {
	al := float64(c.A) / 255 * a
	return color.RGBA{uint8(float64(c.R) * al), uint8(float64(c.G) * al), uint8(float64(c.B) * al), uint8(255 * al)}
}

// over puts c at coverage a over what dst has at (x, y).
func over(dst *image.RGBA, x, y int, c color.NRGBA, a float64) {
	if a <= 0 {
		return
	}
	src := premul(c, a)
	d := dst.RGBAAt(x, y)
	k := 1 - float64(src.A)/255
	dst.SetRGBA(x, y, color.RGBA{
		src.R + uint8(float64(d.R)*k), src.G + uint8(float64(d.G)*k),
		src.B + uint8(float64(d.B)*k), src.A + uint8(float64(d.A)*k),
	})
}

// roundRect fills a w×h rounded rectangle with an edge `edgeW` wide.
func roundRect(img *image.RGBA, w, h, radius float64, fill, edge color.NRGBA, edgeW float64) {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			d := roundedDistance(float64(x-b.Min.X)+0.5, float64(y-b.Min.Y)+0.5, w, h, radius)
			outer := clamp01(-d + 0.5)
			if outer == 0 {
				continue
			}
			over(img, x, y, fill, outer)
			if edgeW > 0 {
				over(img, x, y, edge, outer*(1-clamp01(-d-edgeW+0.5)))
			}
		}
	}
}

// disc fills a circle of radius r centred in img.
func disc(img *image.RGBA, r float64, c color.NRGBA) {
	b := img.Bounds()
	cx, cy := float64(b.Min.X)+r, float64(b.Min.Y)+r
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			over(img, x, y, c, clamp01(r-math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy)+0.5))
		}
	}
}

// ringRGBA draws a ring of width `width` just inside the edge of a circle of radius r centred in img.
func ringRGBA(img *image.RGBA, r, width float64, c color.NRGBA) {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			d := math.Abs(math.Hypot(float64(x)+0.5-r, float64(y)+0.5-r) - (r - width/2))
			over(img, x, y, c, clamp01(width/2-d+0.5))
		}
	}
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

// mapDisplayName turns a map's file name into how people say it: de_dust2 → Dust2.
func mapDisplayName(m string) string {
	m = strings.TrimSpace(m)
	if i := strings.IndexByte(m, '_'); i > 0 && i <= 3 {
		m = m[i+1:]
	}
	if m == "" {
		return ""
	}
	r := []rune(strings.ReplaceAll(m, "_", " "))
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// cornerTag is the tournament and the stage, in capitals.
func cornerTag(tournament, stage string) string {
	parts := []string{}
	for _, s := range []string{tournament, stage} {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, strings.ToUpper(s))
		}
	}
	return strings.Join(parts, " · ")
}

// softShadow is img's shape, blurred over about `radius` pixels, in black at `opacity`.
func softShadow(img *image.RGBA, radius int, opacity float64) *image.RGBA {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	a := make([]float64, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			a[y*w+x] = float64(img.Pix[y*img.Stride+x*4+3]) / 255
		}
	}
	// Three box blurs, across then down, come close to a gaussian.
	tmp := make([]float64, w*h)
	box := func(src, dst []float64, n, stride, count, step int) {
		for line := 0; line < count; line++ {
			base := line * step
			sum := 0.0
			for i := -radius; i <= radius; i++ {
				if i >= 0 && i < n {
					sum += src[base+i*stride]
				}
			}
			for i := 0; i < n; i++ {
				dst[base+i*stride] = sum / float64(2*radius+1)
				if j := i - radius; j >= 0 {
					sum -= src[base+j*stride]
				}
				if j := i + radius + 1; j < n {
					sum += src[base+j*stride]
				}
			}
		}
	}
	for pass := 0; pass < 3; pass++ {
		box(a, tmp, w, 1, h, w)
		box(tmp, a, h, w, w, 1)
	}
	out := image.NewRGBA(b)
	for i, v := range a {
		out.Pix[i*4+3] = uint8(255 * clamp01(v*opacity*1.6))
	}
	return out
}
