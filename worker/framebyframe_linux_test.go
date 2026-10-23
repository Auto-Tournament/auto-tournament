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
