package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindsCS2InAnotherLibrary(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, ".local/share/Steam")
	other := filepath.Join(t.TempDir(), "SteamLibrary")
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(root, "steamapps/common/SteamLinuxRuntime_sniper"), 0o755))
	must(os.WriteFile(filepath.Join(root, "steamapps/common/SteamLinuxRuntime_sniper/run"), nil, 0o755))
	game := filepath.Join(other, "steamapps/common/Counter-Strike Global Offensive/game")
	must(os.MkdirAll(game, 0o755))
	must(os.WriteFile(filepath.Join(game, "cs2.sh"), nil, 0o755))
	must(os.WriteFile(filepath.Join(root, "steamapps/libraryfolders.vdf"), []byte(`"libraryfolders"
{
	"0" { "path" "`+root+`" }
	"1" { "path" "`+other+`" }
}`), 0o644))
	if got := cs2GameDir(home); got != game {
		t.Fatalf("cs2 %q, want %q", got, game)
	}
	realRoot, _ := filepath.EvalSymlinks(root)
	if got := sniperRun(home); got != filepath.Join(realRoot, "steamapps/common/SteamLinuxRuntime_sniper/run") {
		t.Fatalf("sniper %q", got)
	}
	if got := cs2GameDir(t.TempDir()); got != "" {
		t.Fatalf("no Steam: %q", got)
	}
}
