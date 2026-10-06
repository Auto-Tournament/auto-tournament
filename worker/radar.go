package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image/png"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Radar is one map level's radar image and how world coordinates land on it
// (resource/overviews/<map>.txt): px = (x - PosX) / Scale, py = (PosY - y) / Scale.
type Radar struct {
	Map         string   `json:"map"`
	Level       string   `json:"level"` // "default", or a vertical section ("lower")
	PosX        float64  `json:"posX"`
	PosY        float64  `json:"posY"`
	Scale       float64  `json:"scale"`
	AltitudeMin *float64 `json:"altitudeMin,omitempty"`
	AltitudeMax *float64 `json:"altitudeMax,omitempty"`
	CRC         uint32   `json:"crc"` // of the texture, to skip unchanged ones
	PNG         string   `json:"png,omitempty"`
}

var (
	kvPair    = regexp.MustCompile(`"([^"]+)"\s+"([^"]*)"`)
	kvSection = regexp.MustCompile(`"([^"]+)"\s*(?://[^\n]*)?\s*\{([^{}]*)\}`)
)

// ParseOverview reads an overview file: the map's position and scale, and
// its vertical sections (Nuke's "lower") with their altitude ranges.
func ParseOverview(mapName, text string) []Radar {
	// Comments out, so a `// "pos_x"` note never counts.
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		if j := strings.Index(l, "//"); j >= 0 {
			lines[i] = l[:j]
		}
	}
	text = strings.Join(lines, "\n")
	num := func(src, key string) float64 {
		for _, m := range kvPair.FindAllStringSubmatch(src, -1) {
			if strings.EqualFold(m[1], key) {
				v, _ := strconv.ParseFloat(strings.TrimSpace(m[2]), 64)
				return v
			}
		}
		return 0
	}
	base := Radar{Map: mapName, Level: "default", PosX: num(text, "pos_x"), PosY: num(text, "pos_y"), Scale: num(text, "scale")}
	if base.Scale == 0 {
		return nil
	}
	out := []Radar{}
	if i := strings.Index(strings.ToLower(text), `"verticalsections"`); i >= 0 {
		for _, m := range kvSection.FindAllStringSubmatch(text[i:], -1) {
			if strings.EqualFold(m[1], "verticalsections") {
				continue
			}
			r := base
			r.Level = strings.ToLower(m[1])
			lo, hi := num(m[2], "AltitudeMin"), num(m[2], "AltitudeMax")
			r.AltitudeMin, r.AltitudeMax = &lo, &hi
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		out = append(out, base)
	}
	return out
}

// radarTexture is where a level's image lives in the package.
func radarTexture(mapName, level string) string {
	if level == "default" {
		return "panorama/images/overheadmaps/" + mapName + "_radar_psd.vtex_c"
	}
	return "panorama/images/overheadmaps/" + mapName + "_" + level + "_radar_psd.vtex_c"
}

// localRadars lists the radars in the CS2 install's packages: the game's own
// (pak01) and any workshop map packages found under the extra directories.
func localRadars(cs2Dir string, workshopDirs []string) (map[string]Radar, map[string]*VPK) {
	radars := map[string]Radar{}
	from := map[string]*VPK{}
	packages := []string{filepath.Join(cs2Dir, "pak01_dir.vpk")}
	for _, dir := range append([]string{filepath.Join(cs2Dir, "maps")}, workshopDirs...) {
		_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(p, ".vpk") && !strings.Contains(filepath.Base(p), "_0") {
				packages = append(packages, p)
			}
			return nil
		})
	}
	for _, pkg := range packages {
		v, err := OpenVPK(pkg)
		if err != nil {
			continue
		}
		for _, p := range v.List("resource/overviews/", ".txt") {
			mapName := strings.TrimSuffix(filepath.Base(p), ".txt")
			text, err := v.Read(p)
			if err != nil {
				continue
			}
			for _, r := range ParseOverview(mapName, string(text)) {
				crc, ok := v.CRC(radarTexture(mapName, r.Level))
				if !ok {
					continue
				}
				r.CRC = crc
				key := r.Map + "/" + r.Level
				radars[key] = r
				from[key] = v
			}
		}
	}
	return radars, from
}

// SyncRadars uploads every radar the platform lacks or has an older copy of.
func (c *client) SyncRadars(ctx context.Context, cs2Dir string, workshopDirs []string) error {
	local, from := localRadars(cs2Dir, workshopDirs)
	if len(local) == 0 {
		return fmt.Errorf("no radars under %s", cs2Dir)
	}
	res, err := c.do(ctx, http.MethodGet, "/api/game/cs2/radars", "", nil)
	if err != nil {
		return err
	}
	var known struct {
		Radars []Radar `json:"radars"`
	}
	err = json.NewDecoder(res.Body).Decode(&known)
	res.Body.Close()
	if err != nil {
		return err
	}
	have := map[string]uint32{}
	for _, r := range known.Radars {
		have[r.Map+"/"+r.Level] = r.CRC
	}
	sent := 0
	for key, r := range local {
		if crc, ok := have[key]; ok && crc == r.CRC {
			continue
		}
		data, err := from[key].Read(radarTexture(r.Map, r.Level))
		if err != nil {
			log.Printf("radar %s: %v", key, err)
			continue
		}
		img, err := DecodeVtex(data)
		if err != nil {
			log.Printf("radar %s: %v", key, err)
			continue
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			continue
		}
		r.PNG = base64.StdEncoding.EncodeToString(buf.Bytes())
		up, err := c.do(ctx, http.MethodPut, "/api/game/cs2/radars/"+r.Map+"/"+r.Level, "application/json", jsonBody(r))
		if err != nil {
			return err
		}
		up.Body.Close()
		if err := ok(up, "radar "+key); err != nil {
			log.Print(err)
			continue
		}
		sent++
	}
	log.Printf("radars: %d in the install, %d sent", len(local), sent)
	return nil
}

func jsonBody(v any) *bytes.Reader {
	b, _ := json.Marshal(v)
	return bytes.NewReader(b)
}
