package main

import "math"

// A clip watched on its own opens on the game, not on its caption card: the
// page around it already says who, which match, map and round, and what the
// moment is. The card's opening is slowed down, so it also held the kill back
// two or three seconds. Reels still open each clip with its card: they are
// joined from the clean twin, which keeps the slowed opening, and dressed
// from the overlay's recipe (overlay.go).

// standaloneLead is how much of the game a clip on its own keeps before its
// first kill, when that comes before the opening would have ended.
const standaloneLead = 1.0

// standaloneStart is where (seconds into the clean twin) a clip on its own
// starts: where the caption card's slowed opening is back to full speed, or
// standaloneLead before the first kill when that is sooner. 0 when the clip
// has no opening card.
func standaloneStart(o overlayRecipe) float64 {
	if len(o.Parts) == 0 {
		return 0
	}
	p := o.Parts[0]
	if p.Card == nil || p.Settled {
		return 0
	}
	start := p.Start + cardExit + introUpSec
	for _, k := range p.Feed {
		if k.At >= 0 {
			start = math.Min(start, p.Start+k.At-standaloneLead)
		}
	}
	return math.Max(0, math.Round(start*100)/100)
}

// withoutCards is the recipe with no caption cards: the kill feed and the
// logo only.
func withoutCards(o overlayRecipe) overlayRecipe {
	parts := make([]overlayPart, len(o.Parts))
	for i, p := range o.Parts {
		p.Card = nil
		parts[i] = p
	}
	o.Parts = parts
	return o
}

// continueRecipe is a clip's recipe from `skip` seconds in (its clean twin cut
// there): the same player again in a reel, so the caption card is already
// small (no entrance, no blur) and the kill feed carries on.
func continueRecipe(o overlayRecipe, skip float64) overlayRecipe {
	out := o
	out.Duration = math.Max(0, o.Duration-skip)
	out.Parts = nil
	for _, p := range o.Parts {
		end := p.Start + p.Duration
		if end <= skip {
			continue
		}
		cut := math.Max(0, skip-p.Start)
		p.Start = math.Max(0, p.Start-skip)
		p.Duration = end - skip - p.Start
		if cut > 0 {
			p.FadeIn = 0
			feed := make([]feedKill, len(p.Feed))
			for i, k := range p.Feed {
				k.At -= cut
				feed[i] = k
			}
			p.Feed = feed
		}
		if p.Card != nil {
			p.Settled = true
		}
		out.Parts = append(out.Parts, p)
	}
	return out
}

// continueReactions are a clip's crowd reactions from `skip` seconds in.
func continueReactions(rs []reaction, skip float64) []reaction {
	var out []reaction
	for _, r := range rs {
		if r.T >= skip {
			r.T -= skip
			out = append(out, r)
		}
	}
	return out
}
