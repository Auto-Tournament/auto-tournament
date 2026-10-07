package main

import (
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

func TestSpeedRampSlowsFromTheKill(t *testing.T) {
	segs := speedRamp(3+tailSec, 3)
	if segs[0].From != 0 || segs[0].To != 3 || segs[0].Speed != 1 {
		t.Fatalf("full speed until the kill: %+v", segs[0])
	}
	last := segs[len(segs)-1]
	if last.Speed != slowmoSpeed || math.Abs(last.To-(3+tailSec)) > 1e-9 {
		t.Fatalf("ends held slow: %+v", last)
	}
	prev := 1.0
	slowing := 0.0
	for _, s := range segs[1 : len(segs)-1] {
		if s.Speed > prev {
			t.Fatalf("speeds up again: %+v", segs)
		}
		prev = s.Speed
		slowing += (s.To - s.From) / s.Speed
	}
	held := (last.To - last.From) / last.Speed
	if slowing < 0.7 || slowing > 1.3 || held < 2.5 || held > 3.5 {
		t.Fatalf("slowing %.2f s, held %.2f s", slowing, held)
	}
}

func TestVideoFilterCardAndLogo(t *testing.T) {
	f := videoFilter(overlay{card: 2, logo: 3, width: 2560, height: 1440})
	for _, want := range []string{
		"[2:v]format=rgba,fade=t=in", "[base][card]overlay=80:H-80-h:eof_action=pass",
		"[3:v]scale=307:-1,format=rgba,colorchannelmixer=aa=0.25", "[withcard][logo]overlay=W-w-80:H-h-80:shortest=1",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if plain := videoFilter(overlay{card: -1, logo: -1, width: 2560, height: 1440}); strings.Contains(plain, "overlay") {
		t.Fatalf("no card, no logo: %s", plain)
	}
}
