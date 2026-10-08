package main

// The kill feed's art, from the game's own files: `at-worker export-hud
// <game/csgo> <out dir>` takes CS2's weapon icons and kill-feed marks
// (headshot, wallbang, no-scope, through smoke, blind, in-air, assist…)
// out of pak01 and writes them as plain SVGs (and PNGs where CS2 keeps a
// texture), with an index.json the recorder and the platform read. The
// recorder draws its own kill feed from them (Vikunja 1910), so nothing of
// CS2's HUD needs to be on screen while recording.
//
// CS2 keeps Panorama's SVGs compiled (`.vsvg_c`): a Source 2 resource whose
// data block holds the SVG text as it was, so it is cut back out as is.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// hudSources are the folders in pak01 the kill feed draws from.
var hudSources = []struct {
	prefix string // in the package
	group  string // in the export
}{
	{"panorama/images/icons/equipment/", "weapons"},
	{"panorama/images/hud/deathnotice/", "deathnotice"},
	{"panorama/images/icons/ui/", "ui"},
}

// hudIcon is one exported file.
type hudIcon struct {
	Group  string `json:"group"`  // weapons | deathnotice | ui
	Name   string `json:"name"`   // ak47, icon_headshot…
	File   string `json:"file"`   // relative to the export: weapons/ak47.svg
	Source string `json:"source"` // where it was in pak01
}

// exportHud writes the kill feed's icons from <csgo>/pak01_dir.vpk to out.
func exportHud(csgoDir, out string, groups map[string]bool) ([]hudIcon, error) {
	pak, err := OpenVPK(filepath.Join(csgoDir, "pak01_dir.vpk"))
	if err != nil {
		return nil, err
	}
	var icons []hudIcon
	for _, src := range hudSources {
		if len(groups) > 0 && !groups[src.group] {
			continue
		}
		if err := os.MkdirAll(filepath.Join(out, src.group), 0o755); err != nil {
			return nil, err
		}
		for _, p := range pak.List(src.prefix, "") {
			ext := path.Ext(p)
			name := strings.TrimSuffix(path.Base(p), ext)
			// Only this folder's own files, not its subfolders.
			if strings.Contains(strings.TrimPrefix(p, src.prefix), "/") {
				continue
			}
			data, err := pak.Read(p)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", p, err)
			}
			var file string
			switch ext {
			case ".vsvg_c":
				svg, ok := svgFromResource(data)
				if !ok {
					continue
				}
				file = filepath.Join(src.group, name+".svg")
				err = os.WriteFile(filepath.Join(out, file), svg, 0o644)
			case ".vtex_c":
				img, derr := DecodeVtex(data)
				if derr != nil {
					continue
				}
				file = filepath.Join(src.group, strings.TrimSuffix(name, "_png")+".png")
				var buf bytes.Buffer
				if err = png.Encode(&buf, img); err == nil {
					err = os.WriteFile(filepath.Join(out, file), buf.Bytes(), 0o644)
				}
			default:
				continue
			}
			if err != nil {
				return nil, err
			}
			icons = append(icons, hudIcon{Group: src.group, Name: strings.TrimSuffix(name, "_png"), File: filepath.ToSlash(file), Source: p})
		}
	}
	sort.Slice(icons, func(i, j int) bool {
		if icons[i].Group != icons[j].Group {
			return icons[i].Group < icons[j].Group
		}
		return icons[i].Name < icons[j].Name
	})
	index, _ := json.MarshalIndent(map[string]any{"icons": icons}, "", "  ")
	if err := os.WriteFile(filepath.Join(out, "index.json"), index, 0o644); err != nil {
		return nil, err
	}
	return icons, nil
}

// svgFromResource cuts the SVG text out of a compiled Panorama SVG.
func svgFromResource(data []byte) ([]byte, bool) {
	start := bytes.Index(data, []byte("<svg"))
	if start < 0 {
		return nil, false
	}
	// An XML declaration just before it belongs to it.
	if decl := bytes.LastIndex(data[:start], []byte("<?xml")); decl >= 0 && start-decl < 200 {
		start = decl
	}
	end := bytes.LastIndex(data, []byte("</svg>"))
	if end < start {
		return nil, false
	}
	return data[start : end+len("</svg>")], true
}

// hudList is `at-worker hud-list <game/csgo> [prefix]`: what pak01 holds
// under a folder, for finding the kill feed's art.
func hudList(csgoDir, prefix string) error {
	pak, err := OpenVPK(filepath.Join(csgoDir, "pak01_dir.vpk"))
	if err != nil {
		return err
	}
	for _, p := range pak.List(prefix, "") {
		fmt.Println(p)
	}
	return nil
}
