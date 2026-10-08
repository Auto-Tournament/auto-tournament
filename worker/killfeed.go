package main

// Our own kill feed (Vikunja 1910, the canvas's look A in the site's colours):
// CS2's HUD is off while recording and the clip's kills are drawn in the top
// right instead. The clip's player's kills (and their death) stay to the end
// of the clip; anyone else's kill shows for killFeedHoldSec, as in CS2. A row
// is a solid plate: the killer, an assister, the weapon and CS2's marks
// (headshot, wallbang, smoke, no-scope, blind, in the air), the victim. The
// clip's player's team is orange, the other team ink; the player's own rows
// get an orange edge.

import (
	"bytes"
	"image"
	"image/color"
	"math"
	"os"
	"path/filepath"
	"sync"

	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/math/fixed"
)

// killFeedHoldSec is how long someone else's kill stays, and how long it takes to go.
const (
	killFeedHoldSec = 5.0
	killFeedFadeSec = 0.4
	killFeedInSec   = 0.32
)

var (
	feedPlate = color.NRGBA{0x18, 0x11, 0x0e, 0xff} // paper2; its alpha is the row's (below)
	feedEdge  = color.NRGBA{0xf4, 0xed, 0xeb, 0x14}
	feedMine  = color.NRGBA{0xff, 0x8f, 0x66, 0xff} // the clip's player's team
	feedOther = color.NRGBA{0xf6, 0xef, 0xec, 0xff} // the other team
	feedPlus  = color.NRGBA{0xc4, 0xbc, 0xb9, 0xff}
)

// The plates are as see-through as CS2's death notices
// (panorama/styles/hud/huddeathnotice.css): hud-blur-bg-color #000000a0 for
// others' kills, #000000e7 for the player's own, over gaussian(2,2,2) of the
// world behind (videoFilter).
const (
	feedPlateOtherAlpha = 0xa0
	feedPlateOwnAlpha   = 0xe7
	feedBlurSigma       = 2.0 // at 1080 lines
)

// feedKill is one row: what happened, and when in the clip (output seconds;
// below 0: already there when the clip's piece starts).
type feedKill struct {
	At                      float64
	Tick                    int    // the kill's demo tick
	Killer, Assister        string // "" for none (a fall, the bomb)
	Victim                  string
	KillerMine, VictimMine  bool // on the clip's player's team
	Weapon                  string
	Headshot, Penetrated    bool
	Smoke, NoScope, Blind   bool
	InAir, FlashAssist, Own bool // Own: the clip's player killed or died
}

// iconSet draws the game's icons (export-hud) at any height, once each.
type iconSet struct {
	dir   string
	mu    sync.Mutex
	cache map[string]*image.RGBA
}

func newIconSet(dir string) *iconSet {
	if dir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dir, "index.json")); err != nil {
		return nil
	}
	return &iconSet{dir: dir, cache: map[string]*image.RGBA{}}
}

// icon is group/name at h pixels tall (white, premultiplied), or nil.
func (s *iconSet) icon(group, name string, h int) *image.RGBA {
	if s == nil || name == "" || h <= 0 {
		return nil
	}
	key := group + "/" + name + "@" + itoa(h)
	s.mu.Lock()
	defer s.mu.Unlock()
	if img, ok := s.cache[key]; ok {
		return img
	}
	var img *image.RGBA
	if data, err := os.ReadFile(filepath.Join(s.dir, group, name+".svg")); err == nil {
		img = rasterSVG(data, h)
	}
	s.cache[key] = img
	return img
}

// rasterSVG draws an SVG h pixels tall, its width to scale.
func rasterSVG(data []byte, h int) *image.RGBA {
	icon, err := oksvg.ReadIconStream(bytes.NewReader(data), oksvg.IgnoreErrorMode)
	if err != nil || icon.ViewBox.H <= 0 {
		return nil
	}
	w := int(math.Ceil(icon.ViewBox.W / icon.ViewBox.H * float64(h)))
	if w <= 0 {
		return nil
	}
	icon.SetTarget(0, 0, float64(w), float64(h))
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	scanner := rasterx.NewScannerGV(w, h, img, img.Bounds())
	icon.Draw(rasterx.NewDasher(w, h, scanner), 1)
	return img
}

// weaponIcon maps demoinfocs' weapon names to CS2's icon files.
var weaponIcon = map[string]string{
	"AK-47": "ak47", "AUG": "aug", "AWP": "awp", "PP-Bizon": "bizon", "CZ75 Auto": "cz75a",
	"Desert Eagle": "deagle", "Dual Berettas": "elite", "FAMAS": "famas", "Five-SeveN": "fiveseven",
	"G3SG1": "g3sg1", "Galil AR": "galilar", "Glock-18": "glock", "P2000": "hkp2000", "M249": "m249",
	"M4A4": "m4a1", "M4A1": "m4a1_silencer", "M4A1-S": "m4a1_silencer", "MAC-10": "mac10", "MAG-7": "mag7",
	"MP5-SD": "mp5sd", "MP7": "mp7", "MP9": "mp9", "Negev": "negev", "Nova": "nova", "P250": "p250",
	"P90": "p90", "Sawed-Off": "sawedoff", "SCAR-20": "scar20", "SG 553": "sg556", "SSG 08": "ssg08",
	"Tec-9": "tec9", "UMP-45": "ump45", "USP-S": "usp_silencer", "XM1014": "xm1014",
	"R8 Revolver": "revolver", "Zeus x27": "taser", "Knife": "knife", "C4": "c4",
	"Decoy Grenade": "decoy", "Flashbang": "flashbang", "HE Grenade": "hegrenade",
	"Incendiary Grenade": "inferno", "Molotov": "inferno", "Smoke Grenade": "smokegrenade",
}

// feedRender holds the kill feed's rows, drawn once, and lays them out for
// any moment of the clip.
type feedRender struct {
	region image.Rectangle // where the frames go in the video (the top right)
	rows   []feedRow
	gap    int
	frame  *image.RGBA
	length float64 // the piece's output seconds
}

type feedRow struct {
	img        *image.RGBA
	at         float64
	persistent bool
}

// layoutFeed draws each kill's row for a video w×h and the piece's length.
func layoutFeed(kills []feedKill, w, h int, length float64, icons *iconSet) (*feedRender, error) {
	k := float64(h) / 720
	px := func(v float64) int { return int(math.Round(v * k)) }
	nameFace, err := face(geistMedium, 14*k)
	if err != nil {
		return nil, err
	}
	r := &feedRender{gap: px(4), length: length}
	maxW, totalH := 0, 0
	for _, kl := range kills {
		img := drawFeedRow(kl, nameFace, icons, px)
		r.rows = append(r.rows, feedRow{img: img, at: kl.At, persistent: kl.Own})
		maxW = max(maxW, img.Bounds().Dx())
		totalH += img.Bounds().Dy() + r.gap
	}
	// The room the rows can take: wide enough for the widest, tall enough for
	// all of them (with the slide-in's travel), at the top right, even sizes.
	slide := px(24)
	right, top := w-px(22), px(22)
	width := (maxW + slide + 2) &^ 1
	height := (max(totalH, 2) + 2) &^ 1
	left := (right - width) &^ 1
	r.region = image.Rect(left, top&^1, left+width, (top&^1)+height)
	r.frame = image.NewRGBA(image.Rect(0, 0, width, height))
	return r, nil
}

// drawFeedRow draws one row: plate, names, weapon and marks.
func drawFeedRow(kl feedKill, nameFace font.Face, icons *iconSet, px func(float64) int) *image.RGBA {
	h, pad, gap := px(30), px(11), px(7)
	weaponH, markH := px(19), px(17)
	type part struct {
		img  *image.RGBA
		text string
		ink  color.NRGBA
	}
	var parts []part
	add := func(group, name string, size int) {
		if img := icons.icon(group, name, size); img != nil {
			parts = append(parts, part{img: img})
		}
	}
	side := func(mine bool) color.NRGBA {
		if mine {
			return feedMine
		}
		return feedOther
	}
	if kl.Blind {
		add("deathnotice", "blind_kill", markH)
	}
	if kl.Killer != "" {
		parts = append(parts, part{text: kl.Killer, ink: side(kl.KillerMine)})
		if kl.Assister != "" {
			parts = append(parts, part{text: "+", ink: feedPlus})
			if kl.FlashAssist {
				add("weapons", "flashbang_assist", markH)
			}
			parts = append(parts, part{text: kl.Assister, ink: side(kl.KillerMine)})
		}
	}
	if name, ok := weaponIcon[kl.Weapon]; ok && icons.icon("weapons", name, weaponH) != nil {
		add("weapons", name, weaponH)
	} else if kl.Killer == "" || kl.Weapon == "World" || kl.Weapon == "world" {
		add("deathnotice", "icon_suicide", weaponH)
	} else if kl.Weapon != "" {
		parts = append(parts, part{text: kl.Weapon, ink: feedPlus})
	}
	if kl.NoScope {
		add("deathnotice", "noscope", markH)
	}
	if kl.Smoke {
		add("deathnotice", "smoke_kill", markH)
	}
	if kl.Penetrated {
		add("deathnotice", "penetrate", markH)
	}
	if kl.InAir {
		add("deathnotice", "inairkill", markH)
	}
	if kl.Headshot {
		add("deathnotice", "icon_headshot", markH)
	}
	parts = append(parts, part{text: kl.Victim, ink: side(kl.VictimMine)})

	width := pad
	for i, p := range parts {
		if i > 0 {
			width += gap
		}
		if p.img != nil {
			width += p.img.Bounds().Dx()
		} else {
			width += font.MeasureString(nameFace, p.text).Ceil()
		}
	}
	width += pad
	img := image.NewRGBA(image.Rect(0, 0, width, h))
	edge := feedEdge
	edgeW := float64(px(1))
	plate := feedPlate
	plate.A = feedPlateOtherAlpha
	if kl.Own {
		edge, edgeW = cardAccent, math.Max(1.5, 1.5*float64(px(1)))
		plate.A = feedPlateOwnAlpha
	}
	roundRect(img, float64(width), float64(h), float64(px(7)), plate, edge, edgeW)
	m := nameFace.Metrics()
	base := (h + m.Ascent.Ceil() - m.Descent.Ceil()) / 2
	x := pad
	for i, p := range parts {
		if i > 0 {
			x += gap
		}
		if p.img != nil {
			b := p.img.Bounds()
			y := (h - b.Dy()) / 2
			draw.Draw(img, image.Rect(x, y, x+b.Dx(), y+b.Dy()), p.img, image.Point{}, draw.Over)
			x += b.Dx()
		} else {
			(&font.Drawer{Dst: img, Src: image.NewUniform(p.ink), Face: nameFace, Dot: fixed.P(x, base)}).DrawString(p.text)
			x += font.MeasureString(nameFace, p.text).Ceil()
		}
	}
	return img
}

// Frames is how many frames to stream at cardFPS for the piece.
func (r *feedRender) Frames() int { return int(math.Ceil(r.length*cardFPS)) + 1 }

// frameAt draws the feed `t` seconds into the piece: the rows shown then,
// newest at the bottom, each right-aligned. Premultiplied RGBA, the region's size.
func (r *feedRender) frameAt(t float64) *image.RGBA {
	clear(r.frame.Pix)
	y := 0
	width := r.frame.Bounds().Dx()
	for _, row := range r.rows {
		if row.at > t {
			continue
		}
		alpha := 1.0
		if !row.persistent {
			gone := t - row.at - killFeedHoldSec
			if gone >= killFeedFadeSec {
				continue
			}
			if gone > 0 {
				alpha = 1 - gone/killFeedFadeSec
			}
		}
		slide := 0.0
		if row.at >= 0 {
			p := easeOut((t - row.at) / killFeedInSec)
			alpha *= p
			slide = (1 - p) * float64(width-row.img.Bounds().Dx())
			slide = math.Min(slide, float64(row.img.Bounds().Dy())*0.8)
		}
		b := row.img.Bounds()
		x := width - b.Dx() + int(math.Round(slide))
		blendOver(r.frame, row.img, x, y, alpha)
		y += b.Dy() + r.gap
	}
	return r.frame
}

// blendOver draws premultiplied src onto dst at (x, y) at alpha.
func blendOver(dst, src *image.RGBA, x0, y0 int, alpha float64) {
	if alpha <= 0 {
		return
	}
	b := src.Bounds()
	db := dst.Bounds()
	for y := 0; y < b.Dy(); y++ {
		ty := y0 + y
		if ty < 0 || ty >= db.Dy() {
			continue
		}
		for x := 0; x < b.Dx(); x++ {
			tx := x0 + x
			if tx < 0 || tx >= db.Dx() {
				continue
			}
			s := src.RGBAAt(x, y)
			if s.A == 0 {
				continue
			}
			i := dst.PixOffset(tx, ty)
			sa := float64(s.A) * alpha
			inv := 1 - sa/255
			dst.Pix[i] = uint8(float64(s.R)*alpha + float64(dst.Pix[i])*inv)
			dst.Pix[i+1] = uint8(float64(s.G)*alpha + float64(dst.Pix[i+1])*inv)
			dst.Pix[i+2] = uint8(float64(s.B)*alpha + float64(dst.Pix[i+2])*inv)
			dst.Pix[i+3] = uint8(sa + float64(dst.Pix[i+3])*inv)
		}
	}
}

// feedKillsFor turns the replay's kills between two ticks into rows for the
// clip's player (steam id): who was on whose team, and whether it is theirs.
func feedKillsFor(rp *Replay, player string, from, to int) []feedKill {
	if rp == nil {
		return nil
	}
	names := map[string]string{}
	index := map[string]int{}
	for i, p := range rp.Players {
		names[p.ID] = p.Name
		index[p.ID] = i
	}
	mySide := sideAt(rp, index, player, from)
	var out []feedKill
	for _, k := range rp.Kills {
		if k.Tick < from || k.Tick > to {
			continue
		}
		kl := feedKill{
			Tick: k.Tick, Victim: names[k.Victim], Weapon: k.Weapon, Headshot: k.Headshot, Penetrated: k.Penetrated,
			Smoke: k.ThroughSmoke, NoScope: k.NoScope, Blind: k.AttackerBlind, InAir: k.InAir, FlashAssist: k.AssistedFlash,
		}
		kl.VictimMine = mySide != 0 && sideAt(rp, index, k.Victim, k.Tick) == mySide
		if k.Attacker != nil && *k.Attacker != k.Victim {
			kl.Killer = names[*k.Attacker]
			kl.KillerMine = mySide != 0 && sideAt(rp, index, *k.Attacker, k.Tick) == mySide
			kl.Own = *k.Attacker == player
		}
		if k.Victim == player {
			kl.Own = true
		}
		if k.Assister != nil {
			kl.Assister = names[*k.Assister]
		}
		if kl.Victim == "" {
			continue
		}
		out = append(out, kl)
	}
	return out
}

// sideAt is the player's side (2 T, 3 CT) in the last replay frame at or
// before tick where they were alive; 0 when unknown.
func sideAt(rp *Replay, index map[string]int, player string, tick int) int {
	i, ok := index[player]
	if !ok {
		return 0
	}
	for f := len(rp.Frames) - 1; f >= 0; f-- {
		t, _ := rp.Frames[f][0].(int)
		if t > tick {
			continue
		}
		row, _ := rp.Frames[f][1].([]any)
		if i < len(row) {
			if v, ok := row[i].([6]float64); ok {
				return int(v[4])
			}
		}
		if tick-t > 64*30 {
			break
		}
	}
	return 0
}
