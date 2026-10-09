package main

import (
	"os"
	"path/filepath"
	"regexp"
)

// Where Steam keeps its libraries on Linux, so a recorder finds CS2 and the
// Steam Linux Runtime itself when AT_CS2_GAME / AT_SNIPER_RUN are not set:
// every library libraryfolders.vdf lists, under each Steam root.
var steamRoots = []string{
	".local/share/Steam",
	".steam/steam",
	".steam/root",
	".var/app/com.valvesoftware.Steam/.local/share/Steam",
}

var vdfPath = regexp.MustCompile(`"path"\s+"([^"]+)"`)

// steamLibraries is every Steam library under home, the roots themselves
// included, each once.
func steamLibraries(home string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		if p == "" || seen[p] {
			return
		}
		if st, err := os.Stat(filepath.Join(p, "steamapps")); err == nil && st.IsDir() {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, r := range steamRoots {
		root := filepath.Join(home, r)
		if real, err := filepath.EvalSymlinks(root); err == nil {
			root = real
		}
		add(root)
		b, err := os.ReadFile(filepath.Join(root, "steamapps", "libraryfolders.vdf"))
		if err != nil {
			continue
		}
		for _, m := range vdfPath.FindAllStringSubmatch(string(b), -1) {
			add(m[1])
		}
	}
	return out
}

// findInLibraries is the first library's steamapps/common/<rel> that exists, or "".
func findInLibraries(home, rel string) string {
	for _, lib := range steamLibraries(home) {
		p := filepath.Join(lib, "steamapps", "common", rel)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// cs2GameDir is CS2's game folder (the one with cs2.sh), or "".
func cs2GameDir(home string) string {
	p := findInLibraries(home, filepath.Join("Counter-Strike Global Offensive", "game", "cs2.sh"))
	if p == "" {
		return ""
	}
	return filepath.Dir(p)
}

// sniperRun is the Steam Linux Runtime's run script cs2.sh needs, or "".
func sniperRun(home string) string {
	return findInLibraries(home, filepath.Join("SteamLinuxRuntime_sniper", "run"))
}
