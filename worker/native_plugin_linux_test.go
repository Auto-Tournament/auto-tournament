//go:build linux

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativePluginInstallRestoreAndBackupOwnership(t *testing.T) {
	useNativePluginFixture(t)
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

func useNativePluginFixture(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "libserver.so")
	if err := os.WriteFile(path, []byte("native plugin fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AT_NATIVE_PLUGIN", path)
}

func TestNativePluginRecoversAfterProcessExit(t *testing.T) {
	if dir := os.Getenv("AT_TEST_NATIVE_CRASH_DIR"); dir != "" {
		if _, err := installNativePlugin(dir); err != nil {
			t.Fatal(err)
		}
		return // Exit without invoking cleanup, as an interrupted worker would.
	}
	useNativePluginFixture(t)
	dir := t.TempDir()
	info := filepath.Join(dir, "csgo", "gameinfo.gi")
	if err := os.MkdirAll(filepath.Dir(info), 0755); err != nil {
		t.Fatal(err)
	}
	original := []byte("GameInfo\n{\n Game csgo\n Game core\n}\n")
	if err := os.WriteFile(info, original, 0640); err != nil {
		t.Fatal(err)
	}
	child := exec.Command(os.Args[0], "-test.run=^TestNativePluginRecoversAfterProcessExit$")
	child.Env = append(os.Environ(), "AT_TEST_NATIVE_CRASH_DIR="+dir)
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("interrupted worker: %v: %s", err, output)
	}
	restore, err := installNativePlugin(dir)
	if err != nil {
		t.Fatalf("next recording did not recover: %v", err)
	}
	restore()
	got, err := os.ReadFile(info)
	if err != nil || string(got) != string(original) {
		t.Fatalf("original gameinfo lost: %q, %v", got, err)
	}
	stat, err := os.Stat(info)
	if err != nil || stat.Mode().Perm() != 0640 {
		t.Fatalf("gameinfo permissions not preserved: %v", err)
	}
	if _, err := os.Stat(info + ".backup"); !os.IsNotExist(err) {
		t.Fatalf("backup left behind: %v", err)
	}
}

func TestNativeGameinfoRecoveryPreservesUnrelatedChanges(t *testing.T) {
	for _, current := range []string{"Game csgo\n// user's edit\n", "Game csgo/at-native\nGame csgo\n// user's edit\n"} {
		dir := t.TempDir()
		info, backup := filepath.Join(dir, "gameinfo.gi"), filepath.Join(dir, "gameinfo.gi.backup")
		original := "Game csgo\n"
		if err := os.WriteFile(info, []byte(current), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(backup, []byte(original), 0644); err != nil {
			t.Fatal(err)
		}
		if err := recoverNativeGameinfo(info, backup); err == nil {
			t.Fatal("recovered unrelated gameinfo changes")
		}
		got, _ := os.ReadFile(info)
		saved, _ := os.ReadFile(backup)
		if string(got) != current || string(saved) != original {
			t.Fatal("changed gameinfo or backup on refusal")
		}
	}
}

func TestNativeGameinfoRecoveryBeforePatchAndAfterRestore(t *testing.T) {
	dir := t.TempDir()
	info, backup := filepath.Join(dir, "gameinfo.gi"), filepath.Join(dir, "gameinfo.gi.backup")
	original := "Game csgo\n"
	for _, path := range []string{info, backup} {
		if err := os.WriteFile(path, []byte(original), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := recoverNativeGameinfo(info, backup); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(backup); !os.IsNotExist(err) {
		t.Fatalf("stale backup not removed: %v", err)
	}
}

func TestNativePluginRequiresConfiguredArtifact(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "csgo"), 0755); err != nil {
		t.Fatal(err)
	}
	info := filepath.Join(dir, "csgo", "gameinfo.gi")
	if err := os.WriteFile(info, []byte("Game csgo\n"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"", filepath.Join(dir, "missing.so")} {
		t.Setenv("AT_NATIVE_PLUGIN", path)
		if _, err := installNativePlugin(dir); err == nil || !strings.Contains(err.Error(), "AT_NATIVE_PLUGIN") {
			t.Fatalf("missing plugin: %v", err)
		}
		got, _ := os.ReadFile(info)
		if string(got) != "Game csgo\n" {
			t.Fatal("patched gameinfo without a plugin")
		}
	}
}
