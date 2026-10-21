//go:build linux

package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type nativeAction struct {
	Tick int    `json:"tick"`
	Cmd  string `json:"cmd"`
}

type nativeSequence struct {
	Actions []nativeAction `json:"actions"`
}

// nativeActions deliberately records a run-up and a small tail. The editor
// trims those using the frame clock, including fractional ticks above 64 fps.
func nativeActions(from, to, fps int, prefix, player string, look []string, predict string) []nativeSequence {
	setup := max(2, from-tickrate)
	var actions []nativeAction
	add := func(tick int, cmd string) { actions = append(actions, nativeAction{tick, cmd}) }
	for _, cmd := range look {
		if predict != "" && strings.HasPrefix(cmd, "cl_demo_predict ") {
			cmd = predict
		}
		add(1, cmd)
	}
	add(1, "host_timescale 1")
	add(1, "demo_timescale 1")
	add(1, "host_framerate 0")
	add(1, fmt.Sprintf("demo_gototick %d", setup-1))
	add(setup, "sv_cheats 1")
	add(setup, "spec_mode 1")
	// Never interpolate a name into a multi-command console string.
	account, hasAccount := followAccounts.Load(player)
	player = strings.NewReplacer("\"", "", ";", "", "\n", "", "\r", "").Replace(player)
	add(setup, fmt.Sprintf("spec_player \"%s\"", player))
	if hasAccount {
		add(setup, fmt.Sprintf("spec_player_by_accountid %d", account.(uint32)))
	}
	add(setup, fmt.Sprintf("host_framerate %d", fps))
	checkpoint := max(setup+1, from-4)
	add(checkpoint, "pause_playback")
	add(checkpoint, "demo_pause")
	add(checkpoint, "echo AT_NATIVE_READY_"+prefix)
	add(from, "startmovie "+prefix)
	add(to, "endmovie")
	add(to, "echo AT_NATIVE_DONE_"+prefix)
	add(to, "demo_pause")
	return []nativeSequence{{Actions: actions}}
}

// The existing editor accepts a fixed-size I420 file and a tick per frame.
// Only these two things and the engine's WAV cross the capture boundary.
func nativeFrameTicks(firstTick, count, fps int) []float64 {
	ticks := make([]float64, count)
	for i := range ticks {
		ticks[i] = float64(firstTick) + float64(i)*tickrate/float64(fps)
	}
	return ticks
}

func nativeFPS(segs []segment) int {
	speed := 1.0
	for _, s := range segs {
		if s.Speed > 0 && s.Speed < speed {
			speed = s.Speed
		}
	}
	return int(math.Ceil(outputFPS / speed))
}

type nativeFiles struct {
	frames []string
	wav    string
	first  int
}

func checkNativeDimensions(path string, width, height int) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var header [18]byte
	if _, err := io.ReadFull(f, header[:]); err != nil {
		return err
	}
	w, h := int(binary.LittleEndian.Uint16(header[12:14])), int(binary.LittleEndian.Uint16(header[14:16]))
	if w != width || h != height {
		return fmt.Errorf("native movie is %dx%d; requested %dx%d (check CS2 window and desktop settings)", w, h, width, height)
	}
	return nil
}

// CS2 writes images to the plugin search path but WAVs to csgo/movie.
func findNativeFiles(gameDir, prefix string) (nativeFiles, error) {
	var out nativeFiles
	imageName := regexp.MustCompile("^" + regexp.QuoteMeta(prefix) + `([0-9]{8})\.tga$`)
	for _, root := range []string{filepath.Join(gameDir, "csgo", "at-native", "movie"), filepath.Join(gameDir, "csgo", "movie")} {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if os.IsNotExist(err) {
				return nil
			}
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if imageName.MatchString(entry.Name()) {
				out.frames = append(out.frames, path)
			}
			if entry.Name() == prefix+".wav" {
				out.wav = path
			}
			return nil
		})
		if err != nil {
			return out, err
		}
	}
	sort.Strings(out.frames)
	if len(out.frames) == 0 || out.wav == "" {
		return out, errors.New("native capture produced no image sequence or WAV; check the native plugin compatibility with this CS2 build")
	}
	out.first, _ = strconv.Atoi(imageName.FindStringSubmatch(filepath.Base(out.frames[0]))[1])
	for i, path := range out.frames {
		n, _ := strconv.Atoi(imageName.FindStringSubmatch(filepath.Base(path))[1])
		if n != out.first+i || filepath.Dir(path) != filepath.Dir(out.frames[0]) {
			return out, errors.New("native capture image sequence has missing or duplicate frames")
		}
	}
	return out, nil
}

func (f nativeFiles) remove() {
	if env("AT_KEEP_SCRATCH", "") != "" {
		return
	}
	for _, p := range f.frames {
		_ = os.Remove(p)
	}
	if f.wav != "" {
		_ = os.Remove(f.wav)
	}
}
