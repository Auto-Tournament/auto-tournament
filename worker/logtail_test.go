package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogTailKeepsTheEndWithoutSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gamescope.log")
	var b strings.Builder
	for i := 0; i < 100; i++ {
		b.WriteString("line ")
		b.WriteString(strings.Repeat("x", i%3))
		b.WriteString("\n")
	}
	b.WriteString("AT_WORKER_TOKEN=atr_abc123_secretpart and key: hunter2\n")
	b.WriteString("[gamescope] vblank failed\n")
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	tail := logTail(path, 5, 3000)
	if !strings.HasSuffix(tail, "[gamescope] vblank failed") {
		t.Fatalf("not the end: %q", tail)
	}
	if strings.Count(tail, "\n") != 4 {
		t.Fatalf("not 5 lines: %q", tail)
	}
	for _, leak := range []string{"atr_abc123", "secretpart", "hunter2"} {
		if strings.Contains(tail, leak) {
			t.Fatalf("leaked %q: %q", leak, tail)
		}
	}
	if logTail(filepath.Join(t.TempDir(), "missing.log"), 5, 100) != "" {
		t.Fatal("a missing log gave a tail")
	}
}
