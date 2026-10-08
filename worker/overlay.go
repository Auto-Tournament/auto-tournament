package main

// Clean clips and their overlay, the way a video editor keeps footage and
// titles apart: every clip and reel is stored twice, as recorded (clean: no
// caption card, kill feed or logo) and dressed (the export people watch and
// share), and next to them the overlay's recipe: what the card says, the kill
// feed's rows and when each part of the video starts. The dressed file can be
// made again from the clean one and the recipe (redress), without CS2: a new
// card design, a fixed name, another tournament's tag.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"strings"
)

// overlayVersion is the recipe's format.
const overlayVersion = 1

// overlayRecipe is everything drawn over a clean video.
type overlayRecipe struct {
	Version  int           `json:"version"`
	Width    int           `json:"width"`  // the size the overlay is drawn for (the video's)
	Height   int           `json:"height"` // (the card and the feed scale with it)
	Duration float64       `json:"duration"`
	Logo     bool          `json:"logo"` // the Auto Tournament logo in the corner
	Parts    []overlayPart `json:"parts"`
}

// overlayPart is one stretch of the video with its own card and kill feed: a
// piece of a clip (they blend into each other), or a whole clip in a reel.
type overlayPart struct {
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	// FadeIn and FadeOut: the part's overlay comes and goes with its picture
	// (a crossfade, or the orange wipe).
	FadeIn  float64 `json:"fadeIn,omitempty"`
	FadeOut float64 `json:"fadeOut,omitempty"`
	// WipeIn and WipeOut: the orange wipe (reel.go) sweeps across instead,
	// left to right: the overlay shows only where the picture already does.
	WipeIn  bool       `json:"wipeIn,omitempty"`
	WipeOut bool       `json:"wipeOut,omitempty"`
	Card    *cardSpec  `json:"card,omitempty"`
	Settled bool       `json:"settled,omitempty"` // the card already small (no entrance)
	Feed    []feedKill `json:"feed,omitempty"`
}

// cardSpec is a caption card's content (captionCard, the avatar as PNG).
type cardSpec struct {
	Name     string `json:"name"`
	Teams    string `json:"teams,omitempty"`
	Team     string `json:"team,omitempty"`
	Opponent string `json:"opponent,omitempty"`
	Map      string `json:"map,omitempty"`
	Round    int    `json:"round,omitempty"`
	Kind     string `json:"kind,omitempty"`
	Tag      string `json:"tag,omitempty"`
	Avatar   []byte `json:"avatar,omitempty"`
}

func specOf(c captionCard) *cardSpec {
	s := &cardSpec{Name: c.name, Teams: c.teams, Team: c.team, Opponent: c.opponent, Map: c.mapName,
		Round: c.round, Kind: c.kind, Tag: c.tag}
	if c.avatar != nil {
		var b bytes.Buffer
		if png.Encode(&b, c.avatar) == nil {
			s.Avatar = b.Bytes()
		}
	}
	return s
}

func (s *cardSpec) card() captionCard {
	c := captionCard{name: s.Name, teams: s.Teams, team: s.Team, opponent: s.Opponent, mapName: s.Map,
		round: s.Round, kind: s.Kind, tag: s.Tag}
	if len(s.Avatar) > 0 {
		if img, err := png.Decode(bytes.NewReader(s.Avatar)); err == nil {
			c.avatar = img
		}
	}
	return c
}

// cleanPathOf and overlayPathOf are where a video's clean twin and its
// overlay's recipe go: next to it.
func cleanPathOf(video string) string {
	return strings.TrimSuffix(video, ".mp4") + ".clean.mp4"
}

func overlayPathOf(video string) string {
	return strings.TrimSuffix(video, ".mp4") + ".overlay.json"
}

func (o overlayRecipe) save(path string) error {
	b, err := json.Marshal(o)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func loadOverlay(path string) (overlayRecipe, error) {
	var o overlayRecipe
	b, err := os.ReadFile(path)
	if err != nil {
		return o, err
	}
	if err := json.Unmarshal(b, &o); err != nil {
		return o, fmt.Errorf("%s: %w", path, err)
	}
	if o.Version != overlayVersion {
		return o, fmt.Errorf("%s: overlay version %d, this worker draws %d", path, o.Version, overlayVersion)
	}
	return o, nil
}

// clipOverlay is a clip's recipe from its pieces (in order, each `durations`
// long, blending into the next over reelCrossfade).
func clipOverlay(w, h int, logo bool, durations []float64, parts []overlayPart) overlayRecipe {
	o := overlayRecipe{Version: overlayVersion, Width: w, Height: h, Logo: logo}
	at := 0.0
	for i := range parts {
		p := parts[i]
		p.Start, p.Duration = at, durations[i]
		if i > 0 {
			p.FadeIn = reelCrossfade
		}
		if i < len(parts)-1 {
			p.FadeOut = reelCrossfade
		}
		o.Parts = append(o.Parts, p)
		at += durations[i]
		if i < len(parts)-1 {
			at -= reelCrossfade
		}
	}
	o.Duration = at
	return o
}

// reelOverlay puts clips' recipes where the clips start in a reel (starts,
// from buildReel), the orange wipe between them; the reel runs `length`.
// With outro, the last frame is held and everything fades out (reel.go).
func reelOverlay(clips []overlayRecipe, starts []float64, length float64, outro bool) overlayRecipe {
	o := overlayRecipe{Version: overlayVersion, Duration: length}
	for i, c := range clips {
		if i == 0 {
			o.Width, o.Height = c.Width, c.Height
		}
		o.Logo = o.Logo || c.Logo
		for j, p := range c.Parts {
			p.Start += starts[i]
			// Every clip but a reel's first (unless the intro wipes to it) comes in behind the wipe.
			if j == 0 && (i > 0 || starts[0] > 0) {
				p.WipeIn = true
			}
			if j == len(c.Parts)-1 {
				if i < len(clips)-1 {
					p.WipeOut = true
				} else if outro {
					p.Duration += outroHold
					p.FadeOut = outroFade
				}
			}
			o.Parts = append(o.Parts, p)
		}
	}
	return o
}

// overlayTrack draws a recipe as two streams of frames, the cards' and the
// kill feeds' (each in one box the whole video long), for videoFilter.
type overlayTrack struct {
	recipe  overlayRecipe
	cards   []*cardRender // per part, nil without a card
	feeds   []*feedRender // per part, nil without rows
	cardBox image.Rectangle
	feedBox image.Rectangle
	frame   *image.RGBA
}

func newOverlayTrack(o overlayRecipe, icons *iconSet) (*overlayTrack, error) {
	t := &overlayTrack{recipe: o, cards: make([]*cardRender, len(o.Parts)), feeds: make([]*feedRender, len(o.Parts))}
	for i, p := range o.Parts {
		if p.Card != nil {
			c, err := p.Card.card().layout(o.Width, o.Height)
			if err != nil {
				return nil, fmt.Errorf("card: %w", err)
			}
			if p.Settled {
				c = c.Settled()
			}
			t.cards[i] = c
			t.cardBox = t.cardBox.Union(c.region)
		}
		if len(p.Feed) > 0 && icons != nil {
			f, err := layoutFeed(p.Feed, o.Width, o.Height, p.Duration, icons)
			if err != nil {
				return nil, fmt.Errorf("kill feed: %w", err)
			}
			t.feeds[i] = f
			t.feedBox = t.feedBox.Union(f.region)
		}
	}
	// Even sizes and corners, for yuv420p.
	even := func(r image.Rectangle) image.Rectangle {
		return image.Rect(r.Min.X&^1, r.Min.Y&^1, (r.Max.X+1)&^1, (r.Max.Y+1)&^1)
	}
	t.cardBox, t.feedBox = even(t.cardBox), even(t.feedBox)
	size := t.cardBox.Size()
	if fs := t.feedBox.Size(); fs.X*fs.Y > size.X*size.Y {
		size = fs
	}
	t.frame = image.NewRGBA(image.Rect(0, 0, size.X, size.Y))
	return t, nil
}

// Frames is how many frames each stream has (at cardFPS).
func (t *overlayTrack) Frames() int {
	return int(math.Ceil(t.recipe.Duration*cardFPS)) + 1
}

// shown is where (in the video's columns) part p shows at `at` seconds,
// through the orange wipes, for a video `width` wide.
func (p overlayPart) shown(at float64, width int) (from, to int) {
	local := at - p.Start
	from, to = 0, width
	if p.WipeIn && local < wipeInSec {
		// The picture comes in from the left behind the bar.
		to = int(math.Round(clamp01(local/wipeInSec) * float64(width)))
	}
	if p.WipeOut && local > p.Duration-wipeInSec {
		// The bar covers it from the left.
		from = int(math.Round(clamp01((local-(p.Duration-wipeInSec))/wipeInSec) * float64(width)))
	}
	return from, to
}

// weight is how much of part p shows at `at` seconds (its fades), 0 outside it.
func (p overlayPart) weight(at float64) float64 {
	local := at - p.Start
	if local < 0 || local > p.Duration {
		return 0
	}
	w := 1.0
	if p.FadeIn > 0 {
		w = math.Min(w, local/p.FadeIn)
	}
	if p.FadeOut > 0 {
		w = math.Min(w, (p.Duration-local)/p.FadeOut)
	}
	return clamp01(w)
}

// cardFrame and feedFrame are the streams' frames at `at` seconds: the parts
// showing then, each at its weight (premultiplied, so a weight scales every
// channel), in their boxes.
func (t *overlayTrack) cardFrame(at float64) []byte {
	return t.compose(t.cardBox, at, func(i int, local float64) (*image.RGBA, image.Point) {
		c := t.cards[i]
		if c == nil {
			return nil, image.Point{}
		}
		return c.frameAt(math.Min(local, cardSec)), c.region.Min
	})
}

func (t *overlayTrack) feedFrame(at float64) []byte {
	return t.compose(t.feedBox, at, func(i int, local float64) (*image.RGBA, image.Point) {
		f := t.feeds[i]
		if f == nil {
			return nil, image.Point{}
		}
		return f.frameAt(local), f.region.Min
	})
}

func (t *overlayTrack) compose(box image.Rectangle, at float64, layer func(i int, local float64) (*image.RGBA, image.Point)) []byte {
	w, h := box.Dx(), box.Dy()
	out := t.frame.Pix[:w*h*4]
	clear(out)
	for i, p := range t.recipe.Parts {
		weight := p.weight(at)
		if weight <= 0 {
			continue
		}
		img, origin := layer(i, at-p.Start)
		if img == nil {
			continue
		}
		from, to := p.shown(at, t.recipe.Width)
		off := origin.Sub(box.Min)
		b := img.Bounds()
		for y := 0; y < b.Dy(); y++ {
			dy := y + off.Y
			if dy < 0 || dy >= h {
				continue
			}
			src := img.Pix[y*img.Stride : y*img.Stride+b.Dx()*4]
			for x := 0; x < b.Dx(); x++ {
				dx := x + off.X
				if dx < 0 || dx >= w || src[x*4+3] == 0 {
					continue
				}
				if vx := box.Min.X + dx; vx < from || vx >= to {
					continue
				}
				d := out[(dy*w+dx)*4:]
				for c := 0; c < 4; c++ {
					d[c] = uint8(math.Min(255, float64(d[c])+float64(src[x*4+c])*weight))
				}
			}
		}
	}
	return out
}

func cloneRGBA(m *image.RGBA) *image.RGBA {
	c := image.NewRGBA(m.Bounds())
	copy(c.Pix, m.Pix)
	return c
}
