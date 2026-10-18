package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWithVideoReplacesAndAdds(t *testing.T) {
	cfg := "\"video.cfg\"\n{\n\t\"setting.msaa_samples\"\t\t\"4\"\n\t\"setting.defaultres\"\t\t\"2560\"\n\t\"Autoconfig\"\t\t\"2\"\n}\n"
	out := withVideo(cfg, map[string]string{"setting.msaa_samples": "0", "setting.defaultres": "1920", "setting.videocfg_ao_detail": "0"})
	for _, want := range []string{"\"setting.msaa_samples\"\t\t\"0\"", "\"setting.defaultres\"\t\t\"1920\"", "\"Autoconfig\"\t\t\"2\"", "\t\"setting.videocfg_ao_detail\"\t\t\"0\"\n}"} {
		if !strings.Contains(out, want) {
			t.Fatalf("no %q in:\n%s", want, out)
		}
	}
	if strings.Count(out, "msaa_samples") != 1 {
		t.Fatalf("msaa twice:\n%s", out)
	}
}

func TestLowVideoResetsHighMemoryDefaults(t *testing.T) {
	cfg := "\"video.cfg\"\n{\n\t\"setting.gpu_mem_level\"\t\t\"3\"\n\t\"setting.gpu_level\"\t\t\"3\"\n}\n"
	out := withVideo(cfg, recordingVideo)
	for _, key := range []string{"setting.gpu_mem_level", "setting.gpu_level", "setting.videocfg_texture_detail"} {
		if !strings.Contains(out, "\""+key+"\"\t\t\"0\"") {
			t.Fatalf("low preset did not reset %s: %s", key, out)
		}
	}
}

func TestNativeVideoForcesWindowedSize(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("AT_CAPTURE_BACKEND", "native")
	t.Setenv("AT_VIDEO", "low")
	path := filepath.Join(home, ".local/share/Steam/userdata/123/730/local/cfg/cs2_video.txt")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("\"video.cfg\"\n{\n\t\"setting.fullscreen\"\t\t\"1\"\n}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	setRecordingVideo(1920, 1080)
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), "\"setting.fullscreen\"\t\t\"0\"") {
		t.Fatalf("native capture retained fullscreen: %s", data)
	}
}
