//go:build linux

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A stalled encoder must leave the job when its attempt expires, allowing
// the worker to stop its game and claim another job rather than overlap it.
func TestReelEncoderStopsAtAttemptDeadline(t *testing.T) {
	dir := t.TempDir()
	for name, script := range map[string]string{
		"ffprobe": "#!/bin/sh\nprintf '1.0\\n'\n",
		"ffmpeg":  "#!/bin/sh\nexec /bin/sleep 60\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	r := &recorder{jobContext: ctx, encoder: "libx264"}
	started := time.Now()
	_, err := r.buildReel([]string{filepath.Join(dir, "clip.mp4")}, nil, nil, filepath.Join(dir, "out.mp4"))
	if err == nil {
		t.Fatal("stalled encoder unexpectedly succeeded")
	}
	if ctx.Err() == nil {
		t.Fatalf("encoder failed before the attempt deadline: %v", err)
	}
	if time.Since(started) > 3*time.Second {
		t.Fatal("encoder did not stop promptly after cancellation")
	}
}
