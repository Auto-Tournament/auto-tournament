package main

import "testing"

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
