package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRecordBenchmarkRejectsInvalidArguments(t *testing.T) {
	for _, args := range [][]string{nil, {"demo.dem"}, {"demo.dem", "out", "extra"}} {
		if err := recordBenchmark(args); err == nil || !strings.Contains(err.Error(), "usage:") {
			t.Fatalf("recordBenchmark(%q) = %v, want usage error", args, err)
		}
	}
}

func TestRecordBenchmarkRejectsUnreadableDemo(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "out")
	err := recordBenchmark([]string{filepath.Join(dir, "missing.dem"), out})
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing demo: %v, want file-not-found error", err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatalf("failed benchmark created output directory: %v", err)
	}
}

func TestRecordBenchmarkRejectsMalformedDemo(t *testing.T) {
	dir := t.TempDir()
	demo := filepath.Join(dir, "broken.dem")
	if err := os.WriteFile(demo, []byte("not a demo"), 0600); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "out")
	err := recordBenchmark([]string{demo, out})
	if err == nil || !strings.Contains(err.Error(), "benchmark demo:") {
		t.Fatalf("malformed demo: %v, want parser error", err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatalf("failed benchmark created output directory: %v", err)
	}
}
