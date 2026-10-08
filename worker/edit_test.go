package main

import (
	"fmt"
	"image"
	"math"
	"strings"
	"testing"
)

func TestAudioFilterDropsThePitch(t *testing.T) {
	f := audioFilter([]segment{{0, 1, 1}, {1, 2, 0.5}}, 2, -1)
	for _, want := range []string{"atrim=duration=2.0000", "asplit=2[t0][t1]", "[t1]atrim=start=1.0000:end=2.0000,asetpts=PTS-STARTPTS,asetrate=24000,aresample=48000[a1]", "concat=n=2:v=0:a=1[a]"} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if strings.Contains(f, "[t0]atrim=start=0.0000:end=1.0000,asetpts=PTS-STARTPTS,asetrate") {
		t.Fatal("full speed should not be resampled")
	}
}

func TestSpeedRampSlowsHoldsAndPlaysOn(t *testing.T) {
	segs := speedRamp(3+tailSec, 3)
	if segs[0].From != 0 || segs[0].To != 3 || segs[0].Speed != 1 {
		t.Fatalf("full speed until the kill: %+v", segs[0])
	}
	last := segs[len(segs)-1]
	if last.Speed != slowmoSpeed || math.Abs(last.To-(3+tailSec)) > 1e-9 || last.To-last.From < holdSec-1e-9 {
		t.Fatalf("ends slowed for holdSec, at the clip's end: %+v", last)
	}
	var slowing, held float64
	for _, s := range segs[1 : len(segs)-1] {
		if s.Speed > 1-1e-9 {
			t.Fatalf("back at full speed before the end: %+v", s)
		}
		d := (s.To - s.From) / s.Speed
		if s.Speed == slowmoSpeed {
			held += d
		} else {
			slowing += d
		}
	}
	if slowing < 0.8 || slowing > 1.3 || held != 0 {
		t.Fatalf("slowing %.2f s, held %.2f s", slowing, held)
	}
}

func TestVideoFilterCardAndLogo(t *testing.T) {
	f := videoFilter(overlay{card: 2, cardAt: image.Pt(48, 938), logo: 3, feed: -1, width: 2560, height: 1440})
	for _, want := range []string{
		"[base][2:v]overlay=48:938:eof_action=repeat:alpha=premultiplied[withcard]",
		"[3:v]scale=42:42,format=rgba,colorchannelmixer=aa=0.3", "[withcard][logo]overlay=W-w-48:H-h-42:shortest=1",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if plain := videoFilter(overlay{card: -1, logo: -1, feed: -1, width: 2560, height: 1440}); strings.Contains(plain, "overlay") {
		t.Fatalf("no card, no logo: %s", plain)
	}
}

func TestVideoFilterFeedBlursBehind(t *testing.T) {
	f := videoFilter(overlay{card: -1, logo: -1, feed: 2, feedAt: image.Rect(2000, 100, 2500, 400), width: 2560, height: 1440})
	for _, want := range []string{
		"[behind]crop=500:300:2000:100,format=rgba,gblur=sigma=2.7:steps=2[blurred]",
		"[feedmask]colorchannelmixer=aa=1.5938,alphaextract[mask]",
		"[under][frosted]overlay=2000:100",
		"[withblur][feed]overlay=2000:100:eof_action=repeat:alpha=premultiplied[withfeed]",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
}

func TestMomentMarkers(t *testing.T) {
	// Two windows: a kill at 1 s into the first (full speed, 2 s long), then
	// the last kill 1 s into the second, which slows down from there. The
	// second blends in over the last reelCrossfade of the first, so it starts
	// at 2 - 0.4 = 1.6 s.
	w1 := window{from: 0, to: 2 * tickrate, slowmo: -1}
	w2 := window{from: 10 * tickrate, to: 10*tickrate + tickrate + int(math.Ceil(tailSec*tickrate)), slowmo: 11 * tickrate}
	length2 := float64(w2.to-w2.from) / tickrate
	segs := [][]segment{{{0, 2, 1}}, speedRamp(length2, 1)}
	m := momentMarkers([]window{w1, w2}, segs, []int{tickrate, 11 * tickrate})
	if len(m.Kills) != 2 || m.Kills[0] != 1 || m.Kills[1] != 2.6 {
		t.Fatalf("kills = %v, want [1 2.6]", m.Kills)
	}
	if m.Slowmo == nil || m.Slowmo[0] != 2.6 {
		t.Fatalf("slowmo = %v, want to start at 2.6", m.Slowmo)
	}
	want := math.Round((2-reelCrossfade+outputSeconds(segs[1]))*100) / 100
	if m.Duration != want {
		t.Fatalf("duration = %v, want %v", m.Duration, want)
	}
	// The slow motion runs to the cut.
	if math.Abs(m.Slowmo[1]-m.Duration) > 0.05 { // the tail rounds up to whole ticks
		t.Fatalf("slow motion ends at %v, the clip at %v", m.Slowmo[1], m.Duration)
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

func TestEncodeArgsH264At1080p60(t *testing.T) {
	for _, enc := range []string{"libx264", "h264_nvenc"} {
		args := strings.Join(encodeArgs(enc), " ")
		for _, want := range []string{"-c:v " + enc, "-r 60", "-g 120", "-s 1920x1080", "-pix_fmt yuv420p"} {
			if !strings.Contains(args, want) {
				t.Fatalf("%q missing from %s", want, args)
			}
		}
	}
	if gpu := strings.Join(encodeArgs("hevc_nvenc"), " "); !strings.Contains(gpu, "-tag:v hvc1") {
		t.Fatalf("hevc_nvenc not tagged hvc1: %s", gpu)
	}
}

func TestReelFilterFades(t *testing.T) {
	f := reelFilter(reelPlan{durations: []float64{10, 8, 6}, joins: []join{joinFade, joinFade}, width: 1920, height: 1080, fps: 60})
	for _, want := range []string{
		// Every clip's sound is cut or padded to its picture's length first.
		"[1:v]setpts=PTS-STARTPTS,trim=duration=8.000,fps=60,settb=AVTB,scale=1920:1080,setsar=1,format=yuv420p[v1in]",
		"[1:a]asetpts=PTS-STARTPTS,apad,atrim=duration=8.000[a1in]",
		"[v0in][v1in]xfade=transition=fade:duration=0.4:offset=9.600[jv1]",
		"[a0in][a1in]acrossfade=d=0.4[ja1]",
		// The second blend starts 0.4 s before the end of the first two joined: 10 + 8 - 0.4 - 0.4.
		"[jv1][v2in]xfade=transition=fade:duration=0.4:offset=17.200[v]",
		"[ja1][a2in]acrossfade=d=0.4[a]",
	} {
		if !strings.Contains(f, want) {
			t.Fatalf("%q missing from %s", want, f)
		}
	}
	if one := reelFilter(reelPlan{durations: []float64{5}, width: 1920, height: 1080, fps: 60}); !strings.HasSuffix(one, "[v0in]null[v];[a0in]anull[a]") {
		t.Fatalf("one clip: %s", one)
	}
}

func TestAudioFilterIntroGain(t *testing.T) {
	f := audioFilter([]segment{{0, 4, 0.5}, {4, 8, 1}}, 8, 0)
	want := fmt.Sprintf("volume='if(lt(t,%.3f),0.5,", focusOut)
	if !strings.Contains(f, want) || !strings.HasSuffix(f, ":eval=frame[a]") {
		t.Fatalf("no intro gain in %s", f)
	}
	if strings.Contains(audioFilter([]segment{{0, 4, 1}}, 4, -1), "volume=") {
		t.Fatal("gain without an intro")
	}
}
