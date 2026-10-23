package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
)

func TestVAAPIReelTrim(t *testing.T) {
	if os.Getenv("AT_TEST_VAAPI") != "1" {
		t.Skip("set AT_TEST_VAAPI=1 on a VAAPI-capable host")
	}
	dir := t.TempDir()
	in, out := filepath.Join(dir, "in.mp4"), filepath.Join(dir, "out.mp4")
	args := []string{"-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "2", "-c:v", "libx264", in}
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("input: %v: %s", err, b)
	}
	r := &recorder{encoder: "h264_vaapi", jobContext: context.Background()}
	if err := r.cutFrom(in, 0.5, out); err != nil {
		t.Fatal(err)
	}
	b, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", out).Output()
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Streams []struct {
			Codec  string `json:"codec_name"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	duration, err := strconv.ParseFloat(got.Format.Duration, 64)
	if err != nil || duration < 1.4 || duration > 1.6 {
		t.Fatalf("trimmed duration: %s, want about 1.5 seconds", b)
	}
	if len(got.Streams) != 1 || got.Streams[0].Codec != "h264" || got.Streams[0].Width != outputHeight*16/9 || got.Streams[0].Height != outputHeight {
		t.Fatalf("encoded video: %s", b)
	}
}
