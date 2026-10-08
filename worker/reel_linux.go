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
// buildReel joins the clips (after an intro, when there is one) into out and
// says where each clip starts in it.
func (r *recorder) buildReel(paths []string, joins []join, intro *reelIntro, out string) ([]float64, error) {
	return r.buildReelSound(paths, joins, intro, reelSound{}, out)
}

// buildReelSound is buildReel with music and the crowd under the reel's sound.
func (r *recorder) buildReelSound(paths []string, joins []join, intro *reelIntro, sound reelSound, out string) ([]float64, error) {
	if len(joins) != len(paths)-1 {
		return nil, fmt.Errorf("%d joins for %d clips", len(joins), len(paths))
	}
	plan := reelPlan{joins: joins, width: outputHeight * 16 / 9, height: outputHeight, fps: outputFPS}
	for _, p := range paths {
		d, err := probeDuration(p)
		if err != nil {
			return nil, err
		}
		plan.durations = append(plan.durations, d)
	}
	hasIntro := false
	if intro != nil && strings.TrimSpace(intro.Title) != "" {
		introPath := strings.TrimSuffix(out, filepath.Ext(out)) + "-intro.mp4"
		if err := r.buildIntro(paths, plan.durations, *intro, plan.width, plan.height, introPath); err != nil {
			return nil, fmt.Errorf("intro: %w", err)
		}
		defer os.Remove(introPath)
		paths = append([]string{introPath}, paths...)
		plan.durations = append([]float64{introSec}, plan.durations...)
		plan.joins = append([]join{joinWipe}, plan.joins...)
		hasIntro = true
		sound.reactions = append([][]reaction{nil}, sound.reactions...)
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	for _, p := range paths {
		args = append(args, "-i", p)
	}
	musicIn := -1
	if sound.crowd != "" {
		first := 0
		if intro != nil && strings.TrimSpace(intro.Title) != "" {
			first = 1
		}
		c := &partCrowd{first: first, bedIn: map[int]int{}}
		// Each clip's murmur and each reaction its own stretch of the
		// recording, read straight from the file: nothing is buffered.
		for i := first; i < len(plan.durations); i++ {
			start, length := crowdBedSpan(plan, first, i)
			c.bedIn[i] = len(paths) + len(c.bedIn)
			args = append(args, "-stream_loop", "-1", "-ss", fmt.Sprintf("%.3f", start), "-t", fmt.Sprintf("%.3f", length+0.2), "-i", sound.crowd)
		}
		next := len(paths) + len(c.bedIn)
		for _, r := range crowdReactions(plan, first, sound.reactions) {
			r.in = next
			next++
			c.reacts = append(c.reacts, r)
			args = append(args, "-ss", fmt.Sprintf("%.3f", r.from), "-t", fmt.Sprintf("%.3f", r.length), "-i", sound.crowd)
		}
		plan.crowd = c
	}
	if sound.music != "" {
		musicIn = len(paths)
		if plan.crowd != nil {
			musicIn += len(plan.crowd.bedIn) + len(plan.crowd.reacts)
		}
		args = append(args, "-stream_loop", "-1", "-i", sound.music)
	}
	filter := reelFilter(plan) + soundFilter(plan, sound, musicIn, hasIntro)
	args = append(args, "-filter_complex", filter, "-map", "[v]", "-map", "[amix]")
	args = append(args, encodeArgs(r.encoder)...)
	args = append(args, "-movflags", "+faststart", out)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("ffmpeg reel: %v %s", err, strings.TrimSpace(string(b)))
	}
	starts := partStarts(plan)
	if hasIntro {
		starts = starts[1:]
	}
	return starts, nil
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
