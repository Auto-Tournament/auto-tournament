package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// recordingVideo is the video config CS2 records with (AT_VIDEO=low, the
// default): what costs the GPU most and shows least in a 1080p clip turned
// down, since the GPU is what holds capture back (2026-10-08: 99 % at 4x
// MSAA, high shadows and ambient occlusion). AT_VIDEO=keep puts CS2's own back.
var recordingVideo = map[string]string{
	"setting.msaa_samples":              "0",
	"setting.r_csgo_cmaa_enable":        "1", // cheap edge smoothing instead of MSAA
	"setting.videocfg_shadow_quality":   "0",
	"setting.videocfg_dynamic_shadows":  "0",
	"setting.videocfg_ao_detail":        "0",
	"setting.videocfg_particle_detail":  "0",
	"setting.videocfg_texture_detail":   "1",
	"setting.shaderquality":             "0",
	"setting.r_texturefilteringquality": "1",
	"setting.videocfg_fsr_detail":       "0",
	"setting.videocfg_hdr_detail":       "-1",
	"setting.fullscreen":                "1",
	"setting.mat_vsync":                 "0",
}

var videoLine = regexp.MustCompile(`(?m)^(\s*)"([^"]+)"(\s+)"[^"]*"`)

// withVideo is a cs2_video.txt with `set` applied: values replaced where the
// key is there, added before the closing brace where it is not.
func withVideo(cfg string, set map[string]string) string {
	seen := map[string]bool{}
	out := videoLine.ReplaceAllStringFunc(cfg, func(line string) string {
		m := videoLine.FindStringSubmatch(line)
		v, ok := set[m[2]]
		if !ok {
			return line
		}
		seen[m[2]] = true
		return fmt.Sprintf(`%s"%s"%s"%s"`, m[1], m[2], m[3], v)
	})
	var add strings.Builder
	for _, k := range sortedKeys(set) {
		if !seen[k] {
			fmt.Fprintf(&add, "\t\"%s\"\t\t\"%s\"\n", k, set[k])
		}
	}
	if add.Len() == 0 {
		return out
	}
	if i := strings.LastIndex(out, "}"); i >= 0 {
		return out[:i] + add.String() + out[i:]
	}
	return out + add.String()
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// setRecordingVideo writes the recording config (and the size CS2 renders at)
// into every Steam user's cs2_video.txt before CS2 starts; the first time it
// keeps the original next to it (cs2_video.txt.at-original).
func setRecordingVideo(width, height int) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	files, _ := filepath.Glob(filepath.Join(home, ".local/share/Steam/userdata/*/730/local/cfg/cs2_video.txt"))
	if env("AT_VIDEO", "low") == "keep" {
		// CS2's own again, if we changed it before.
		for _, f := range files {
			if b, err := os.ReadFile(f + ".at-original"); err == nil {
				_ = os.WriteFile(f, b, 0o644)
			}
		}
		return
	}
	set := map[string]string{
		"setting.defaultres":       fmt.Sprint(width),
		"setting.defaultresheight": fmt.Sprint(height),
	}
	for k, v := range recordingVideo {
		set[k] = v
	}
	// AT_VIDEO_SET: more, as key=value pairs separated by commas
	// (setting.videocfg_fsr_detail=3 renders smaller and upscales with FSR).
	for _, kv := range strings.Split(env("AT_VIDEO_SET", ""), ",") {
		if k, v, ok := strings.Cut(strings.TrimSpace(kv), "="); ok && k != "" {
			set[k] = v
		}
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		if _, err := os.Stat(f + ".at-original"); os.IsNotExist(err) {
			_ = os.WriteFile(f+".at-original", b, 0o644)
		}
		_ = os.WriteFile(f, []byte(withVideo(string(b), set)), 0o644)
	}
}
