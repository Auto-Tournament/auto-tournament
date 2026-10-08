package main

import (
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
