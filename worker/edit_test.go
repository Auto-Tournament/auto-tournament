package main

import (
	"image"
	"math"
	"strings"
	"testing"
)

func TestAudioFilterDropsThePitch(t *testing.T) {
	f := audioFilter([]segment{{0, 1, 1}, {1, 2, 0.5}}, 2)
	for _, want := range []string{"atrim=duration=2.0000", "asplit=2[t0][t1]", "[t1]atrim=start=1.0000:end=2.0000,asetpts=PTS-STARTPTS,asetrate=24000,aresample=48000[a1]", "concat=n=2:v=0:a=1[a]"} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if strings.Contains(f, "[t0]atrim=start=0.0000:end=1.0000,asetpts=PTS-STARTPTS,asetrate") {
		t.Fatal("full speed should not be resampled")
	}
}

func TestSpeedRampSlowsHoldsSpeedsUpAndPlaysOn(t *testing.T) {
	segs := speedRamp(3+tailSec, 3)
	if segs[0].From != 0 || segs[0].To != 3 || segs[0].Speed != 1 {
		t.Fatalf("full speed until the kill: %+v", segs[0])
	}
	last := segs[len(segs)-1]
	if last.Speed != 1 || math.Abs(last.To-last.From-outroSec) > 1e-9 || math.Abs(last.To-(3+tailSec)) > 1e-9 {
		t.Fatalf("ends with at least %v s at full speed: %+v", outroSec, last)
	}
	var slowing, held, rising float64
	for _, s := range segs[1:] {
		d := (s.To - s.From) / s.Speed
		switch {
		case s.To <= 3+rampSec+1e-9:
			slowing += d
		case s.Speed == slowmoSpeed:
			held += d
		case s.To <= 3+tailSec-outroSec+1e-9:
			rising += d
		}
	}
	if math.Abs(slowing-rising) > 1e-6 {
		t.Fatalf("speeding up (%.3f s) should take as long as slowing down (%.3f s)", rising, slowing)
	}
	if slowing < 0.7 || slowing > 1.3 || held < 1.6 || held > 2.4 {
		t.Fatalf("slowing %.2f s, held %.2f s", slowing, held)
	}
}

func TestVideoFilterCardAndLogo(t *testing.T) {
	f := videoFilter(overlay{card: 2, cardAt: image.Pt(48, 938), logo: 3, width: 2560, height: 1440})
	for _, want := range []string{
		"[base][2:v]overlay=48:938:eof_action=pass:alpha=premultiplied[withcard]",
		"[3:v]scale=42:42,format=rgba,colorchannelmixer=aa=0.3", "[withcard][logo]overlay=W-w-48:H-h-42:shortest=1",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if plain := videoFilter(overlay{card: -1, logo: -1, width: 2560, height: 1440}); strings.Contains(plain, "overlay") {
		t.Fatalf("no card, no logo: %s", plain)
	}
}

func TestMomentMarkers(t *testing.T) {
	// Two windows: a kill at 1 s into the first (full speed, 2 s long), then
	// the last kill 1 s into the second, which slows down from there.
	w1 := window{from: 0, to: 2 * tickrate, slowmo: -1}
	w2 := window{from: 10 * tickrate, to: 10*tickrate + tickrate + int(tailSec*tickrate), slowmo: 11 * tickrate}
	length2 := float64(w2.to-w2.from) / tickrate
	segs := [][]segment{{{0, 2, 1}}, speedRamp(length2, 1)}
	m := momentMarkers([]window{w1, w2}, segs, []int{tickrate, 11 * tickrate})
	if len(m.Kills) != 2 || m.Kills[0] != 1 || m.Kills[1] != 3 {
		t.Fatalf("kills = %v, want [1 3]", m.Kills)
	}
	if m.Slowmo == nil || m.Slowmo[0] != 3 {
		t.Fatalf("slowmo = %v, want to start at 3", m.Slowmo)
	}
	want := math.Round((2+outputSeconds(segs[1]))*100) / 100
	if m.Duration != want {
		t.Fatalf("duration = %v, want %v", m.Duration, want)
	}
	// The slow motion ends where the outro at full speed starts.
	if got := math.Round((m.Duration-m.Slowmo[1])*100) / 100; got != outroSec {
		t.Fatalf("outro = %v, want %v", got, outroSec)
	}
}

func TestIntroSlowsTheOpeningUntilTheCardLeaves(t *testing.T) {
	hold, up := introGame()
	segs := editPlan(8, true, 6)
	if segs[0].Speed != slowmoSpeed || segs[0].To != hold {
		t.Fatalf("opening %+v, want %g s of game at %g", segs[0], hold, slowmoSpeed)
	}
	// It holds until the card starts to leave, and is back at full speed
	// introUpSec later.
	if got := outputAt(segs, hold); math.Abs(got-cardExit) > 1e-6 {
		t.Fatalf("speed-up starts at %g s of video, want %g", got, cardExit)
	}
	if got := outputAt(segs, hold+up) - cardExit; math.Abs(got-introUpSec) > 0.01 {
		t.Fatalf("speed-up takes %g s, want %g", got, introUpSec)
	}
	// Then full speed to the kill, and the slow motion as before.
	full := false
	for _, s := range segs {
		if s.From >= hold+up-1e-6 && s.To <= 6+1e-6 && s.Speed == 1 {
			full = true
		}
	}
	if !full {
		t.Fatalf("no full speed between the opening and the kill: %+v", segs)
	}
	// A kill too soon squeezes the opening instead of overlapping it.
	short := editPlan(4, true, 1.5)
	if outputAt(short, 1.5) <= 0 || short[0].To >= 1.5 {
		t.Fatalf("opening runs into the kill: %+v", short)
	}
}
