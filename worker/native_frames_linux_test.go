//go:build linux

package main

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeFrameClockAndSlowMotion(t *testing.T) {
	old := outputFPS
	outputFPS = 60
	t.Cleanup(func() { outputFPS = old })
	segs := []segment{{From: 0, To: 1, Speed: 1}, {From: 1, To: 2, Speed: 0.5}}
	fps := nativeFPS(segs)
	if fps != 120 {
		t.Fatalf("half speed needs 120 frames/game second, got %d", fps)
	}
	ticks := nativeFrameTicks(100, 241, fps)
	frames, err := timeline([][]float64{ticks}, segs, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 180 {
		t.Fatalf("got %d frames, want 180", len(frames))
	}
	for i, frame := range frames {
		want := 100 + float64(i)*64/60
		if i >= 60 {
			want = 164 + float64(i-60)*32/60
		}
		if math.Abs(ticks[frame.index]-want) > 1e-6 {
			t.Fatalf("frame %d has tick %g, want %g", i, ticks[frame.index], want)
		}
	}
}

func TestNativeActionsOrderAndPlayerEscaping(t *testing.T) {
	sequences := nativeActions(100, 228, 120, "test", "player\";quit\n", []string{"cl_demo_predict 2"}, "cl_demo_predict 0")
	last := -1
	var cmds []string
	for _, a := range sequences[0].Actions {
		if a.Tick < last {
			t.Fatalf("actions are out of order: %+v", a)
		}
		if strings.ContainsAny(a.Cmd, ";\r\n") {
			t.Fatalf("injected console command: %q", a.Cmd)
		}
		last = a.Tick
		cmds = append(cmds, a.Cmd)
	}
	joined := strings.Join(cmds, "\n")
	for _, want := range []string{"cl_demo_predict 0", "host_framerate 120", "pause_playback\ndemo_pause\necho AT_NATIVE_READY_test", "startmovie test", "endmovie\necho AT_NATIVE_DONE_test\ndemo_pause"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %s", want, joined)
		}
	}
}

func TestNativeFilesRejectMissingImages(t *testing.T) {
	dir := t.TempDir()
	images := filepath.Join(dir, "csgo", "at-native", "movie")
	audio := filepath.Join(dir, "csgo", "movie")
	for _, p := range []string{images, audio} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{filepath.Join(images, "test00000000.tga"), filepath.Join(images, "test00000002.tga"), filepath.Join(audio, "test.wav")} {
		if err := os.WriteFile(p, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := findNativeFiles(dir, "test"); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("missing frame accepted: %v", err)
	}
}

// Exercise the actual WebSocket protocol, JSON actions, exported image/WAV
// discovery and FFmpeg conversion without needing a running CS2 or Steam.

func TestNativeFrameDimensionsRejectDesktopSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "frame.tga")
	header := make([]byte, 18)
	binary.LittleEndian.PutUint16(header[12:14], 2360)
	binary.LittleEndian.PutUint16(header[14:16], 1424)
	if err := os.WriteFile(path, header, 0600); err != nil {
		t.Fatal(err)
	}
	if err := checkNativeDimensions(path, 1920, 1080); err == nil || !strings.Contains(err.Error(), "2360x1424") {
		t.Fatalf("wrong-size export accepted: %v", err)
	}
	if err := checkNativeDimensions(path, 2360, 1424); err != nil {
		t.Fatal(err)
	}
}

func TestNativeActionsKeepSessionPrediction(t *testing.T) {
	sequences := nativeActions(100, 228, 120, "test", "player", []string{"cl_demo_predict 2"}, "")
	if sequences[0].Actions[0].Cmd != "cl_demo_predict 2" {
		t.Fatal("native actions changed the session prediction without an override")
	}
}
