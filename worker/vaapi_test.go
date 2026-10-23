package main

import (
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
