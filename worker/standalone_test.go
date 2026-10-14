package main

import (
	"math"
	"testing"
)

func TestStandaloneStart(t *testing.T) {
	card := &cardSpec{Name: "mezii"}
	opening := cardExit + introUpSec
	for _, c := range []struct {
		name string
		o    overlayRecipe
		want float64
	}{
		{"no parts", overlayRecipe{}, 0},
		{"no card", overlayRecipe{Parts: []overlayPart{{Feed: []feedKill{{At: 6}}}}}, 0},
		{"settled card", overlayRecipe{Parts: []overlayPart{{Card: card, Settled: true}}}, 0},
		{"after the opening", overlayRecipe{Parts: []overlayPart{{Card: card, Feed: []feedKill{{At: -1}, {At: 6}}}}}, opening},
		{"a kill in the opening", overlayRecipe{Parts: []overlayPart{{Card: card, Feed: []feedKill{{At: 2}}}}}, 1},
		{"a kill at once", overlayRecipe{Parts: []overlayPart{{Card: card, Feed: []feedKill{{At: 0.4}}}}}, 0},
	} {
		if got := standaloneStart(c.o); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

func TestWithoutCards(t *testing.T) {
	o := overlayRecipe{Parts: []overlayPart{{Card: &cardSpec{Name: "a"}}, {Card: &cardSpec{Name: "a"}, Settled: true}}}
	out := withoutCards(o)
	for i, p := range out.Parts {
		if p.Card != nil {
			t.Errorf("part %d still has its card", i)
		}
	}
	if o.Parts[0].Card == nil {
		t.Error("the recipe it was given lost its card")
	}
}

func TestContinueRecipe(t *testing.T) {
	card := &cardSpec{Name: "alice"}
	o := overlayRecipe{Duration: 12, Parts: []overlayPart{
		{Start: 0, Duration: 7, FadeIn: 0.5, Card: card, Feed: []feedKill{{At: 4}}},
		{Start: 6.5, Duration: 5.5, Card: card, Settled: true, Feed: []feedKill{{At: 1}}},
	}}
	c := continueRecipe(o, 2.6)
	if c.Duration != 12-2.6 || len(c.Parts) != 2 {
		t.Fatalf("got %+v", c)
	}
	p := c.Parts[0]
	if p.Start != 0 || math.Abs(p.Duration-4.4) > 1e-9 || !p.Settled || p.FadeIn != 0 || math.Abs(p.Feed[0].At-1.4) > 1e-9 {
		t.Fatalf("first part %+v", p)
	}
	q := c.Parts[1]
	if math.Abs(q.Start-3.9) > 1e-9 || q.Duration != 5.5 || q.Feed[0].At != 1 {
		t.Fatalf("second part %+v", q)
	}
	// The original is untouched.
	if o.Parts[0].Feed[0].At != 4 || o.Parts[0].Settled {
		t.Fatalf("original changed: %+v", o.Parts[0])
	}
	// A part over before the cut is gone.
	if got := continueRecipe(o, 7.5); len(got.Parts) != 1 {
		t.Fatalf("parts after 7.5: %d", len(got.Parts))
	}
	rs := continueReactions([]reaction{{T: 1}, {T: 5}}, 2.6)
	if len(rs) != 1 || math.Abs(rs[0].T-2.4) > 1e-9 {
		t.Fatalf("reactions %+v", rs)
	}
}
