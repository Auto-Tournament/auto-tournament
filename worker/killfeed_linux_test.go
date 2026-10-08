//go:build linux

package main

import (
	"strings"
	"testing"
)

func TestLookTurnsTheHudOffWithIcons(t *testing.T) {
	r := &recorder{}
	if !strings.Contains(strings.Join(r.look(), ";"), "cl_draw_only_deathnotices 1") {
		t.Fatal("without icons CS2's kill feed should stay")
	}
	r.icons = &iconSet{}
	look := strings.Join(r.look(), ";")
	if !strings.Contains(look, "cl_drawhud_force_deathnotices -1") || !strings.Contains(look, "cl_draw_only_deathnotices 1") {
		t.Fatalf("with icons CS2's kill feed should be off too: %s", look)
	}
}
