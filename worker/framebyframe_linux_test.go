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
	orig := "SearchPaths\n{\n\t\tGame_LowViolence\tcsgo_lv\n\t\tGame\tcsgo\n\t\tGame\tcsgo_imported\n}\n"
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
	want := "SearchPaths\n{\n\t\tGame_LowViolence\tcsgo_lv\n\t\tGame\tcsgo/frame-by-frame\n\t\tGame\tcsgo\n\t\tGame\tcsgo_imported\n}\n"
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
