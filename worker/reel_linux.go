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
	if len(joins) != len(paths)-1 {
		return fmt.Errorf("%d joins for %d clips", len(joins), len(paths))
	}
	plan := reelPlan{joins: joins, width: outputHeight * 16 / 9, height: outputHeight, fps: outputFPS}
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	for _, p := range paths {
		d, err := probeDuration(p)
		if err != nil {
			return err
		}
		plan.durations = append(plan.durations, d)
		args = append(args, "-i", p)
	}
	var render *introRender
	var pipe string
	if intro != nil && strings.TrimSpace(intro.Title) != "" {
		var err error
		if render, err = intro.layout(plan.width, plan.height); err != nil {
			return fmt.Errorf("intro: %w", err)
		}
		plan.intro = true
		pipe = out + ".intro"
		_ = os.Remove(pipe)
		if err := syscall.Mkfifo(pipe, 0o600); err != nil {
			return fmt.Errorf("intro pipe: %w", err)
		}
		defer os.Remove(pipe)
		args = append(args, "-f", "rawvideo", "-pix_fmt", "rgba", "-s", fmt.Sprintf("%dx%d", plan.width, plan.height),
			"-framerate", fmt.Sprint(cardFPS), "-i", pipe)
	}
	args = append(args, "-filter_complex", reelFilter(plan), "-map", "[v]", "-map", "[a]")
	args = append(args, encodeArgs(r.encoder)...)
	args = append(args, "-movflags", "+faststart", out)
	cmd := exec.Command("ffmpeg", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	if render != nil {
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
	} else {
		done <- nil
	}
	waitErr := cmd.Wait()
	if render != nil {
		// ffmpeg gone before it opened the pipe: open the other end so the writer stops waiting.
		if f, err := os.OpenFile(pipe, os.O_RDONLY|syscall.O_NONBLOCK, 0); err == nil {
			f.Close()
		}
	}
	introErr := <-done
	if waitErr != nil {
		return fmt.Errorf("ffmpeg reel: %v %s", waitErr, strings.TrimSpace(stderr.String()))
	}
	if introErr != nil && !strings.Contains(introErr.Error(), "broken pipe") {
		return fmt.Errorf("intro frames: %w", introErr)
	}
	return nil
}
