package main

import (
	"math"
	"strings"
	"testing"
)

func TestAudioFilterDropsThePitch(t *testing.T) {
	f := audioFilter([]segment{{0, 1, 1}, {1, 2, 0.25}}, 2)
	for _, want := range []string{"atrim=duration=2.0000", "asplit=2[t0][t1]", "[t1]atrim=start=1.0000:end=2.0000,asetpts=PTS-STARTPTS,asetrate=12000,aresample=48000[a1]", "concat=n=2:v=0:a=1[a]"} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if strings.Contains(f, "[t0]atrim=start=0.0000:end=1.0000,asetpts=PTS-STARTPTS,asetrate") {
		t.Fatal("full speed should not be resampled")
	}
}

func TestVideoFilterCaption(t *testing.T) {
	f := videoFilter([]string{"Goggles", "3K: AK-47 · Round 7"})
	if !strings.Contains(f, `text='3K\: AK-47 · Round 7'`) || !strings.Contains(f, "text='Goggles'") {
		t.Fatalf("captions missing: %s", f)
	}
}

func TestSpeedRampIsSlowAsTheKillLands(t *testing.T) {
	segs := speedRamp(3+tailSec, 3)
	if segs[0].From != 0 || math.Abs(segs[0].To-(3-rampSec)) > 1e-9 || segs[0].Speed != 1 {
		t.Fatalf("full speed until the slowing: %+v", segs[0])
	}
	at := func(x float64) float64 {
		for _, s := range segs {
			if x >= s.From && x < s.To {
				return s.Speed
			}
		}
		return -1
	}
	if at(3) != slowmoSpeed || at(2.999) > 0.35 {
		t.Fatalf("at the kill %v, just before %v", at(3), at(2.999))
	}
	last := segs[len(segs)-1]
	if last.Speed != slowmoSpeed || math.Abs(last.To-(3+tailSec)) > 1e-9 {
		t.Fatalf("ends held slow: %+v", last)
	}
	slowing := 0.0
	for _, s := range segs[1 : len(segs)-1] {
		slowing += (s.To - s.From) / s.Speed
	}
	held := (last.To - last.From) / last.Speed
	if slowing < 0.7 || slowing > 1.3 || held < 1.2 || held > 2 {
		t.Fatalf("slowing %.2f s, held %.2f s", slowing, held)
	}
}
