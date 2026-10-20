//go:build linux

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Native work is bounded by game output, not elapsed playback time. A frame
// can take seconds on integrated graphics without being dropped.
func (r *recorder) captureNative(g *game, name string, from, to, fps int, raw, wav string) ([]float64, float64, error) {
	timeout := time.Duration(envPositive("AT_NATIVE_TIMEOUT_SECONDS", 3600)) * time.Second
	ctx, cancel := context.WithTimeout(r.commandContext(), timeout)
	defer cancel()
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, 0, err
	}
	prefix := "atnative-" + hex.EncodeToString(random[:])
	// Guard frames make the first/last requested picture independent of
	// tick/frame rounding at the movie boundaries.
	from = max(8, from)
	to += 2
	if g.lastTick > 0 {
		to = min(to, g.lastTick-endMargin)
	}
	if from >= to {
		return nil, 0, errors.New("native capture has an empty tick range")
	}
	// CS2 exports four-byte TGA pixels. Reserve for I420 conversion too,
	// rounded up to leave room for audio and image headers.
	var stat syscall.Statfs_t
	if err := syscall.Statfs(filepath.Join(r.gameDir, "csgo"), &stat); err != nil {
		return nil, 0, err
	}
	estimatedFrames := math.Ceil(float64(to-from) / tickrate * float64(fps))
	requiredBytes := uint64(estimatedFrames) * uint64(g.width*g.height) * 6
	availableBytes := uint64(stat.Bavail) * uint64(stat.Bsize)
	if availableBytes < requiredBytes+(512<<20) {
		return nil, 0, fmt.Errorf("native capture needs approximately %.1f GiB free on the CS2 filesystem", float64(requiredBytes)/(1<<30))
	}
	actionsPath := g.demoPath + ".json"
	sequences := nativeActions(from, to, fps, prefix, name, r.look(), g.nativePredict)
	data, err := json.Marshal(sequences)
	if err != nil {
		return nil, 0, err
	}
	if err := os.WriteFile(actionsPath, data, 0o600); err != nil {
		return nil, 0, err
	}
	defer os.Remove(actionsPath)
	exportDone := false
	defer func() {
		if !exportDone {
			if err := g.stopNativeExport(prefix); err != nil {
				log.Printf("native export shutdown unconfirmed; retaining frames: %v", err)
				return
			}
		}
		files, _ := findNativeFiles(r.gameDir, prefix)
		files.remove()
	}()
	g.con.drain()
	started := time.Now()
	if err := g.native.play(ctx, g.demoPath); err != nil {
		return nil, 0, err
	}
	startMovieLine := regexp.MustCompile(`\[([0-9]+)\] Executing: startmovie ` + regexp.QuoteMeta(prefix))
	firstTick, cameraTick := -1, -1
	cameraChecked := false
	cameraMarker := "AT_NATIVE_READY_" + prefix
	cameraLine := regexp.MustCompile(`\[([0-9]+)\] Executing: echo ` + regexp.QuoteMeta(cameraMarker))
	exportDoneMarker := "AT_NATIVE_DONE_" + prefix
	progress := time.NewTicker(15 * time.Second)
	defer progress.Stop()
	lastProgress, lastCount := time.Now(), 0
recording:
	for {
		select {
		case <-ctx.Done():
			return nil, 0, fmt.Errorf("native frame capture: %w", ctx.Err())
		case <-progress.C:
			files, _ := findNativeFiles(r.gameDir, prefix)
			count := len(files.frames)
			if count > 0 {
				if err := checkNativeDimensions(files.frames[0], g.width, g.height); err != nil {
					return nil, 0, err
				}
			}
			if count > lastCount {
				lastProgress, lastCount = time.Now(), count
			}
			if time.Since(lastProgress) > time.Duration(envPositive("AT_NATIVE_STALL_SECONDS", 180))*time.Second {
				return nil, 0, fmt.Errorf("native capture stopped producing frames (%d exported); check the CS2/plugin logs", count)
			}
			r.report("recording", name, count, int(estimatedFrames))
		case line, ok := <-g.con.lines:
			if !ok {
				return nil, 0, errors.New("CS2 console closed during native capture")
			}
			if m := cameraLine.FindStringSubmatch(line); m != nil {
				cameraTick, _ = strconv.Atoi(m[1])
			}
			if strings.TrimSpace(line) == cameraMarker {
				if cameraTick < 0 || cameraTick >= from {
					return nil, 0, errors.New("native seek missed its camera checkpoint")
				}
				if err := g.checkFollow(name, cameraTick); err != nil {
					return nil, 0, err
				}
				if err := g.con.send("demo_resume"); err != nil {
					return nil, 0, err
				}
				cameraChecked = true
			}
			if m := startMovieLine.FindStringSubmatch(line); m != nil {
				if !cameraChecked {
					return nil, 0, errors.New("native export started before its camera check")
				}
				firstTick, _ = strconv.Atoi(m[1])
			}
			if strings.TrimSpace(line) != exportDoneMarker {
				continue
			}
			exportDone = true
			break recording
		}
	}

	if firstTick < 0 {
		return nil, 0, errors.New("native capture ended without a startmovie tick")
	}
	files, err := findNativeFiles(r.gameDir, prefix)
	if err != nil {
		return nil, 0, err
	}
	if err := checkNativeDimensions(files.frames[0], g.width, g.height); err != nil {
		return nil, 0, err
	}
	// Reject truncated exports, rather than stretching them to fit.
	want := float64(to-firstTick) * float64(fps) / tickrate
	if math.Abs(float64(len(files.frames))-want) > math.Max(3, float64(fps)/tickrate*2) {
		return nil, 0, fmt.Errorf("native capture exported %d frames, expected about %.0f", len(files.frames), want)
	}
	probe, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", files.wav,
	).Output()
	if err != nil {
		return nil, 0, fmt.Errorf("native audio export: %w", err)
	}
	audioSeconds, err := strconv.ParseFloat(strings.TrimSpace(string(probe)), 64)
	pictureSeconds := float64(len(files.frames)) / float64(fps)
	if err != nil || math.Abs(audioSeconds-pictureSeconds) > 0.25 {
		return nil, 0, fmt.Errorf("native audio/video durations differ: audio %.3fs, picture %.3fs", audioSeconds, pictureSeconds)
	}
	r.rate.fps = float64(len(files.frames)) / time.Since(started).Seconds()
	pattern := filepath.Join(filepath.Dir(files.frames[0]), prefix+"%08d.tga")
	args := []string{
		"-y", "-hide_banner", "-loglevel", "error",
		"-framerate", strconv.Itoa(fps), "-start_number", strconv.Itoa(files.first),
		"-i", pattern, "-an", "-pix_fmt", "yuv420p", "-f", "rawvideo", raw,
	}
	if b, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); err != nil {
		return nil, 0, fmt.Errorf("native frame conversion: %w: %s", err, b)
	}
	info, err := os.Stat(raw)
	if err != nil {
		return nil, 0, err
	}
	if info.Size() != int64(len(files.frames))*int64(g.width*g.height*3/2) {
		return nil, 0, errors.New("native movie dimensions differ from the requested capture size")
	}
	if err := copyFile(files.wav, wav); err != nil {
		return nil, 0, err
	}
	_ = g.con.send("host_framerate 0")
	return nativeFrameTicks(firstTick, len(files.frames), fps), float64(firstTick), nil
}

// The console write only queues commands; wait until endmovie has executed.
func (g *game) stopNativeExport(prefix string) error {
	if err := g.con.conn.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return err
	}
	defer g.con.conn.SetWriteDeadline(time.Time{})
	marker := "AT_NATIVE_STOPPED_" + prefix
	if err := g.con.send("endmovie", "demo_pause", "host_framerate 0", "echo "+marker); err != nil {
		return err
	}
	_, _, err := g.con.expect(regexp.MustCompile("^("+regexp.QuoteMeta(marker)+")$"), 3*time.Second)
	return err
}
