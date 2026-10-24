package main

import (
	"reflect"
	"strings"
	"testing"
)

// Only qualities below the output, at no more frames, are cut.
func TestValidCuts(t *testing.T) {
	defer func(h int, fps float64) { outputHeight, outputFPS = h, fps }(outputHeight, outputFPS)
	outputHeight, outputFPS = 1080, 240
	got := validCuts([]videoCut{{1440, 120}, {1080, 120}, {720, 60}, {480, 300}, {480, 60}})
	want := []videoCut{{720, 60}, {480, 60}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("validCuts = %v, want %v", got, want)
	}
}

// A cut is scaled to its height and dropped to its frame rate, at its own bitrate.
func TestCutArgs(t *testing.T) {
	defer func(h int, fps float64, m int) { outputHeight, outputFPS, setMbps = h, fps, m }(outputHeight, outputFPS, setMbps)
	outputHeight, outputFPS, setMbps = 1080, 240, 40 // the admin's ceiling is the highest's, not the cut's
	args := strings.Join(cutArgs("h264_nvenc", "in.mp4", "in.720p60.mp4", videoCut{720, 60}), " ")
	for _, want := range []string{"-i in.mp4", "-vf fps=60", "-r 60", "-s 1280x720", "-maxrate 10M", "in.720p60.mp4"} {
		if !strings.Contains(args, want) {
			t.Fatalf("cutArgs has no %q: %s", want, args)
		}
	}
}
