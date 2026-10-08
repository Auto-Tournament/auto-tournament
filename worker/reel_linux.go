//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// probeDuration is a video's picture length in seconds.
func probeDuration(p string) (float64, error) {
	b, err := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", p).Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe %s: %w", filepath.Base(p), err)
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
	if err != nil {
		return 0, fmt.Errorf("ffprobe %s: %w", filepath.Base(p), err)
	}
	return d, nil
}

// buildReel joins clips into a reel: `joins` says how each goes into the next
// (a crossfade or the orange wipe); with an intro, the reel opens with it over
// a grid of the clips and wipes to the first one.
func (r *recorder) buildReel(paths []string, joins []join, intro *reelIntro, out string) error {
	return r.buildReelSound(paths, joins, intro, reelSound{}, out)
}

// buildReelSound is buildReel with music and the crowd under the reel's sound.
func (r *recorder) buildReelSound(paths []string, joins []join, intro *reelIntro, sound reelSound, out string) error {
	if len(joins) != len(paths)-1 {
		return fmt.Errorf("%d joins for %d clips", len(joins), len(paths))
	}
	plan := reelPlan{joins: joins, width: outputHeight * 16 / 9, height: outputHeight, fps: outputFPS}
	for _, p := range paths {
		d, err := probeDuration(p)
		if err != nil {
			return err
		}
		plan.durations = append(plan.durations, d)
	}
	if intro != nil && strings.TrimSpace(intro.Title) != "" {
		introPath := strings.TrimSuffix(out, filepath.Ext(out)) + "-intro.mp4"
		if err := r.buildIntro(paths, plan.durations, *intro, plan.width, plan.height, introPath); err != nil {
			return fmt.Errorf("intro: %w", err)
		}
		defer os.Remove(introPath)
		paths = append([]string{introPath}, paths...)
		plan.durations = append([]float64{introSec}, plan.durations...)
		plan.joins = append([]join{joinWipe}, plan.joins...)
		sound.kills = append([][]float64{nil}, sound.kills...)
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	for _, p := range paths {
		args = append(args, "-i", p)
	}
	musicIn, crowdIn := -1, -1
	if sound.music != "" {
		musicIn = len(paths)
		args = append(args, "-stream_loop", "-1", "-i", sound.music)
	}
	if sound.crowd != "" {
		crowdIn = len(paths)
		if musicIn >= 0 {
			crowdIn++
		}
		args = append(args, "-i", sound.crowd)
	}
	hasIntro := intro != nil && strings.TrimSpace(intro.Title) != ""
	filter := reelFilter(plan) + soundFilter(plan, sound, musicIn, crowdIn, hasIntro)
	args = append(args, "-filter_complex", filter, "-map", "[v]", "-map", "[amix]")
	args = append(args, encodeArgs(r.encoder)...)
	args = append(args, "-movflags", "+faststart", out)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg reel: %v %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}

// buildIntro renders the intro (intro.go) over a grid of the clips into out.
func (r *recorder) buildIntro(paths []string, durations []float64, intro reelIntro, width, height int, out string) error {
	render, err := intro.layout(width, height)
	if err != nil {
		return err
	}
	cols, rows := gridSize(len(paths))
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	// Each tile its own input, seeked to its stretch: nothing is buffered.
	for _, t := range introTiles(durations) {
		args = append(args, "-ss", fmt.Sprintf("%.3f", t.Start), "-t", fmt.Sprintf("%.3f", introSec/introSlowdown+0.1), "-i", paths[t.Clip])
	}
	pipe := out + ".text"
	_ = os.Remove(pipe)
	if err := syscall.Mkfifo(pipe, 0o600); err != nil {
		return fmt.Errorf("intro pipe: %w", err)
	}
	defer os.Remove(pipe)
	args = append(args, "-f", "rawvideo", "-pix_fmt", "rgba", "-s", fmt.Sprintf("%dx%d", width, height),
		"-framerate", fmt.Sprint(cardFPS), "-i", pipe)
	args = append(args, "-filter_complex", introFilter(cols, rows, width, height, outputFPS), "-map", "[v]", "-map", "[a]")
	args = append(args, encodeArgs(r.encoder)...)
	args = append(args, out)
	cmd := exec.Command("ffmpeg", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() {
		f, err := os.OpenFile(pipe, os.O_WRONLY, 0)
		if err != nil {
			done <- err
			return
		}
		defer f.Close()
		for i := 0; i < render.Frames(); i++ {
			if _, err := f.Write(render.frameAt(float64(i) / cardFPS).Pix); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	waitErr := cmd.Wait()
	// ffmpeg gone before it opened the pipe: open the other end so the writer stops waiting.
	if f, err := os.OpenFile(pipe, os.O_RDONLY|syscall.O_NONBLOCK, 0); err == nil {
		f.Close()
	}
	textErr := <-done
	if waitErr != nil {
		return fmt.Errorf("ffmpeg: %v %s", waitErr, strings.TrimSpace(stderr.String()))
	}
	if textErr != nil && !strings.Contains(textErr.Error(), "broken pipe") {
		return fmt.Errorf("intro text: %w", textErr)
	}
	return nil
}
