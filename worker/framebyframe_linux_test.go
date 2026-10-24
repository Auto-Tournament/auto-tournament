package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestFbfGameinfoPatchAndRestore(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "plugin")
	if err := os.MkdirAll(filepath.Join(src, "bin", "linuxsteamrt64"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "bin", "linuxsteamrt64", "libserver.so"), []byte("so"), 0o644); err != nil {
		t.Fatal(err)
	}
	fbfSource = src
	game := filepath.Join(dir, "game")
	if err := os.MkdirAll(filepath.Join(game, "csgo"), 0o755); err != nil {
		t.Fatal(err)
	}
	// CRLF, as CS2's own gameinfo.gi.
	orig := "SearchPaths\r\n{\r\n\t\tGame_LowViolence\tcsgo_lv\r\n\t\tGame\tcsgo\r\n\t\tGame\tcore\r\n}\r\n"
	gi := filepath.Join(game, "csgo", "gameinfo.gi")
	if err := os.WriteFile(gi, []byte(orig), 0o644); err != nil {
		t.Fatal(err)
	}
	// Twice: a leftover line from a crash is not doubled.
	for i := 0; i < 2; i++ {
		if _, err := fbfInstall(game); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := os.ReadFile(gi)
	want := "SearchPaths\r\n{\r\n\t\tGame_LowViolence\tcsgo_lv\r\n\t\tGame\tcsgo/frame-by-frame\r\n\t\tGame\tcsgo\r\n\t\tGame\tcore\r\n}\r\n"
	if string(got) != want {
		t.Fatalf("patched:\n%q\nwant\n%q", got, want)
	}
	if !exists(filepath.Join(game, "csgo", "frame-by-frame", "bin", "linuxsteamrt64", "libserver.so")) {
		t.Fatal("plugin not copied")
	}
	fbfRestore(gi)
	if got, _ := os.ReadFile(gi); string(got) != orig {
		t.Fatalf("restored:\n%q\nwant\n%q", got, orig)
	}
}

func TestTgaToBGR(t *testing.T) {
	// 2×2, 24 bits, bottom-up (the default): rows come out top first.
	hdr := make([]byte, 18)
	hdr[2], hdr[12], hdr[14], hdr[16] = 2, 2, 2, 24
	bottom := []byte{1, 1, 1, 2, 2, 2}
	top := []byte{3, 3, 3, 4, 4, 4}
	path := filepath.Join(t.TempDir(), "f.tga")
	if err := os.WriteFile(path, append(append(hdr, bottom...), top...), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := tgaToBGR(path, 2, 2, &out); err != nil {
		t.Fatal(err)
	}
	if want := append(append([]byte{}, top...), bottom...); !bytes.Equal(out.Bytes(), want) {
		t.Fatalf("got %v, want %v", out.Bytes(), want)
	}
	if err := tgaToBGR(path, 4, 4, &out); err == nil {
		t.Fatal("a frame of the wrong size was taken")
	}
}

func TestFbfFramesNumbers(t *testing.T) {
	csgo := t.TempDir()
	dir := filepath.Join(csgo, "frame-by-frame", "movie", "2026_10_23_11_49_42")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	movie := "atfbf1792756182640161686_"
	for _, n := range []string{"00000010", "00000002", "00000001"} {
		if err := os.WriteFile(filepath.Join(dir, movie+n+".tga"), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := fbfFrames(csgo, movie)
	if len(got) != 3 || got[0].num != 1 || got[1].num != 2 || got[2].num != 10 {
		t.Fatalf("frames %+v", got)
	}
}

func TestFbfRunsRenderOnlyWhatEachPartNeeds(t *testing.T) {
	defer func(fps float64) { outputFPS = fps }(outputFPS)
	outputFPS = 240
	// a second of run-up, then a clip slowed from its kill at 2 s
	from, want := 1000, 1064
	length := 4.0
	to := want + int(length*tickrate)
	runs := fbfRuns(from, want, to, editPlan(length, false, 2))
	if len(runs) != 3 || !runs[0].runUp || runs[0].from != from || runs[0].to != want {
		t.Fatalf("runs = %+v, want the run-up, the clip at 240 to its kill, the rest at 480", runs)
	}
	if runs[1].fps != 240 || runs[2].fps != 480 || runs[1].to != runs[2].from || runs[2].to != to {
		t.Fatalf("runs = %+v", runs)
	}
	// the slowed part starts on the kill's tick, never after it
	if kill := want + int(2*tickrate); runs[2].from > kill {
		t.Fatalf("slowed from tick %d, after the kill at %d", runs[2].from, kill)
	}
	// a clip that's never slowed is one run after the run-up
	if runs := fbfRuns(from, want, to, editPlan(length, false, -1)); len(runs) != 2 || runs[1].fps != 240 {
		t.Fatalf("unslowed: %+v", runs)
	}
	// a short normal stretch between slowed parts isn't worth a movie of its own
	segs := []segment{{0, 1, 0.5}, {1, 1.1, 1}, {1.1, 3, 0.5}}
	if runs := fbfRuns(want, want, want+int(3*tickrate), segs); len(runs) != 1 || runs[0].fps != 480 {
		t.Fatalf("short gap: %+v", runs)
	}
}

func TestFbfPlanSwitchesMoviesOnTheirFrames(t *testing.T) {
	runs := []fbfRun{{0, 64, 64, true}, {64, 128, 240, false}, {128, 256, 480, false}}
	got := fbfPlan(runs, []int{64, 240, 961}, []string{"", "a_", "b_"})
	want := "0 host_framerate 64\n0 demo_resume\n" +
		"64 host_framerate 240\n64 startmovie a_ tga wav\n" +
		"304 endmovie\n304 host_framerate 480\n304 startmovie b_ tga wav\n" +
		"1265 endmovie\n1265 host_framerate 0\n1265 demo_pause\n"
	if got != want {
		t.Fatalf("plan:\n%s\nwant:\n%s", got, want)
	}
}

func TestCS2VersionFromSteamInf(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "csgo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "csgo", "steam.inf"), []byte("ClientVersion=2000935\r\nPatchVersion=1.41.9.2\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if v := cs2Version(dir); v != "1.41.9.2" {
		t.Fatalf("cs2Version = %q", v)
	}
	if v := cs2Version(t.TempDir()); v != "" {
		t.Fatalf("no steam.inf: %q", v)
	}
}
