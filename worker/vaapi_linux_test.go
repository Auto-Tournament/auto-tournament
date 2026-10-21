package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestVAAPIUploadsSoftwareFrames(t *testing.T) {
	upload := "scale=" + strconv.Itoa(outputHeight*16/9) + ":" + strconv.Itoa(outputHeight) + ":flags=lanczos,format=nv12,hwupload"
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"reel trim", []string{"-i", "in.mp4", "-c:v", "h264_vaapi", "out.mp4"}, upload},
		{"existing filter", []string{"-i", "in.mp4", "-vf", "fps=60", "-c:v", "h264_vaapi", "out.mp4"}, "fps=60," + upload},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original := append([]string(nil), tc.args...)
			got := hwEncode(tc.args, "h264_vaapi")
			found := false
			for i := 0; i+1 < len(got); i++ {
				if got[i] == "-vf" {
					found = got[i+1] == tc.want
				}
			}
			if !found {
				t.Fatalf("missing software frame upload: %q", got)
			}
			if !reflect.DeepEqual(tc.args, original) {
				t.Fatalf("changed the caller's command: %q", tc.args)
			}
			if got := hwEncode(tc.args, "libx264"); !reflect.DeepEqual(got, original) {
				t.Fatalf("changed software encoder arguments: %q", got)
			}
		})
	}
	args := []string{"-i", "in.mp4", "-filter_complex", "[0:v]null[v]", "-map", "[v]", "-c:v", "h264_vaapi", "out.mp4"}
	got := strings.Join(hwEncode(args, "h264_vaapi"), " ")
	if !strings.Contains(got, "[v]"+upload+"[v_hw]") || !strings.Contains(got, "-map [v_hw]") || strings.Contains(got, "-vf ") {
		t.Fatalf("changed labelled graph upload: %s", got)
	}
}

// Opt in on a machine with a VAAPI render device. This exercises the real
// reel-trimming path, which must upload software-decoded frames to the GPU.
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
