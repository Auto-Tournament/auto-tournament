//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativePluginInstallRestoreAndBackupOwnership(t *testing.T) {
	dir := t.TempDir()
	info := filepath.Join(dir, "csgo", "gameinfo.gi")
	if err := os.MkdirAll(filepath.Dir(info), 0o755); err != nil {
		t.Fatal(err)
	}
	original := "GameInfo\n{\n SearchPaths\n {\n\t\tGame\tcsgo\n\t\tGame\tcore\n }\n}\n"
	if err := os.WriteFile(info, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	restore, err := installNativePlugin(dir)
	if err != nil {
		t.Fatal(err)
	}
	modified, _ := os.ReadFile(info)
	if !strings.Contains(string(modified), "Game\tcsgo/at-native") {
		t.Fatalf("plugin search path missing: %s", modified)
	}
	if _, err := installNativePlugin(dir); err == nil {
		t.Fatal("overwrote another installation's backup")
	}
	restore()
	after, _ := os.ReadFile(info)
	if string(after) != original {
		t.Fatalf("gameinfo was not restored: %s", after)
	}
	if _, err := os.Stat(info + ".backup"); !os.IsNotExist(err) {
		t.Fatalf("backup left behind: %v", err)
	}
	// The plugin may already have restored and removed the backup itself.
	restore()
}
