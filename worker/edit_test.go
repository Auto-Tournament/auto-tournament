package main

import (
	"math"
	"strings"
	"testing"
)

func TestSpeedRampCoversTheRecording(t *testing.T) {
	segs := speedRamp(8, 6)
	if segs[0].From != 0 || segs[len(segs)-1].To != 8 {
		t.Fatalf("not the whole recording: %+v", segs)
	}
	for i := 1; i < len(segs); i++ {
		if math.Abs(segs[i].From-segs[i-1].To) > 1e-9 {
			t.Fatalf("gap between %+v and %+v", segs[i-1], segs[i])
		}
	}
}

func TestSpeedRampSlowsIntoTheKill(t *testing.T) {
	segs := speedRamp(8, 6)
	var at func(x float64) float64 = func(x float64) float64 {
		for _, s := range segs {
			if x >= s.From && x < s.To {
				return s.Speed
			}
		}
		return -1
	}
	if at(1) != 1 || at(7.9) != 1 {
		t.Fatalf("full speed away from the kill: %+v", segs)
	}
	if at(6.1) != slowmoSpeed {
		t.Fatalf("slowest right after the kill, got %v", at(6.1))
	}
	// Each step into the kill is slower than the last.
	prev := 1.0
	for x := 5.45; x < 6; x += 0.1 {
		if at(x) > prev {
			t.Fatalf("speeds up at %.2f: %+v", x, segs)
		}
		prev = at(x)
	}
}

func TestSpeedRampClipsAtTheEnd(t *testing.T) {
	// The kill 0.2 s from the end: the hold and ramp out are cut.
	segs := speedRamp(5, 4.8)
	if last := segs[len(segs)-1]; last.To != 5 || last.Speed != slowmoSpeed {
		t.Fatalf("got %+v", segs)
	}
	if got := outputSeconds(segs); got < 5 || got > 7 {
		t.Fatalf("output %v s", got)
	}
}

func TestAtempoChain(t *testing.T) {
	for speed, want := range map[float64]string{
		1:     "anull",
		0.25:  "atempo=0.5,atempo=0.5000",
		0.375: "atempo=0.5,atempo=0.7500",
		0.875: "atempo=0.8750",
	} {
		if got := atempoChain(speed); got != want {
			t.Fatalf("%v: got %q want %q", speed, got, want)
		}
	}
}

func TestMomentFilterCaption(t *testing.T) {
	f := momentFilter([]segment{{0, 1, 1}, {1, 2, 0.25}}, "R7 · 3K: AK-47")
	for _, want := range []string{"[1:a]asplit=2[t0][t1]", "atempo=0.5,atempo=0.5000[a1]", "concat=n=2:v=1:a=1[cv][ca]", `3K\: AK-47`} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
}
