//go:build linux

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeDisplayAcceptsLargerBrowserOutput(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	logPath := filepath.Join(dir, "args")
	script := "#!/bin/sh\nif [ \"$1\" = --json ]; then\n echo '[{\"name\":\"WL-1\",\"enabled\":true,\"modes\":[{\"width\":2360,\"height\":1424,\"current\":true}]}]'\nelse\n printf '%s ' \"$@\" > \"" + logPath + "\"\nfi\n"
	if err := os.WriteFile(filepath.Join(dir, "wlr-randr"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("AT_NATIVE_DISPLAY_SETUP", "1")
	if err := prepareNativeDisplay(context.Background(), 1920, 1080); err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(logPath)
	if strings.Contains(string(args), "--mode") || !strings.Contains(string(args), "--scale 1") {
		t.Fatalf("unexpected display request: %s", args)
	}
	if err := prepareNativeDisplay(context.Background(), 3840, 2160); err == nil {
		t.Fatal("accepted undersized display")
	}
}

func TestNativeWindowRulesKeepRequestedSize(t *testing.T) {
	t.Setenv("LABWC_PID", "123")
	dir := t.TempDir()
	path := filepath.Join(dir, "rc.xml")
	original := `<labwc_config><windowRules><windowRule identifier="*"><action name="Maximize" /></windowRule><windowRule identifier="steam" serverDecoration="no" /></windowRules></labwc_config>`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "labwc"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := prepareNativeWindowRules(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	backup, _ := os.ReadFile(path + ".at-native-original")
	if strings.Contains(string(data), "Maximize") || !strings.Contains(string(data), `identifier="steam"`) || string(backup) != original {
		t.Fatalf("unexpected window rules or backup: %s", data)
	}
	if err := prepareNativeWindowRules(context.Background(), path); err != nil {
		t.Fatal(err)
	}
}

func TestNativeWindowRulesRetryFailedReload(t *testing.T) {
	t.Setenv("LABWC_PID", "123")
	dir := t.TempDir()
	path := filepath.Join(dir, "rc.xml")
	original := `<labwc_config><windowRule identifier="*"><action name="Maximize" /></windowRule></labwc_config>`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	command := filepath.Join(dir, "labwc")
	if err := os.WriteFile(command, []byte("#!/bin/sh\nexit 1\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := prepareNativeWindowRules(context.Background(), path); err == nil {
		t.Fatal("accepted a failed desktop reload")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != original {
		t.Fatalf("failed reload did not restore original rules: %s, %v", data, err)
	}
	if err := prepareNativeWindowRules(context.Background(), path); err == nil {
		t.Fatal("retry skipped the failing reload")
	}
	if err := os.WriteFile(command, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := prepareNativeWindowRules(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(path)
	if err != nil || strings.Contains(string(data), "Maximize") {
		t.Fatalf("successful retry retained old rules: %s, %v", data, err)
	}
}
