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
// a grid of the clips and wipes to the first one. It says where each clip
// starts in the reel.
func (r *recorder) buildReel(paths []string, joins []join, intro *reelIntro, out string) ([]float64, error) {
	return r.buildReelSound(paths, joins, intro, reelSound{}, out)
}

// buildReelSound is buildReel with music under the reel's sound (sound.music,
// local tests only) and its crowd rendered on its own into sound.crowdOut:
// the reel itself keeps only the game.
func (r *recorder) buildReelSound(paths []string, joins []join, intro *reelIntro, sound reelSound, out string) ([]float64, error) {
	if len(joins) != len(paths)-1 {
		return nil, fmt.Errorf("%d joins for %d clips", len(joins), len(paths))
	}
	plan := reelPlan{joins: joins, width: outputHeight * 16 / 9, height: outputHeight, fps: outputFPS, outro: sound.outro}
	for _, p := range paths {
		d, err := probeDuration(p)
		if err != nil {
			return nil, err
		}
		plan.durations = append(plan.durations, d)
	}
	// Every clip with its clean twin and overlay recipe beside it (overlay.go):
	// the reel is joined from the clean clips and dressed afterwards with its
	// own overlay (the clips' cards and kill feeds, restyled for the reel).
	var recipes []overlayRecipe
	dressed := out
	if env("AT_CROWD_ONLY", "") != "1" {
		for _, p := range paths {
			o, err := loadOverlay(overlayPathOf(p))
			if err != nil || !exists(cleanPathOf(p)) {
				recipes = nil
				break
			}
			recipes = append(recipes, o)
		}
	}
	if recipes != nil {
		clean := make([]string, len(paths))
		for i, p := range paths {
			clean[i] = cleanPathOf(p)
		}
		paths = clean
		out = cleanPathOf(dressed)
		defer os.Remove(out)
	}
	hasIntro := false
	introPath := ""
	if intro != nil && strings.TrimSpace(intro.Title) != "" {
		introPath = strings.TrimSuffix(out, filepath.Ext(out)) + "-intro.mp4"
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
	if sound.music != "" {
		musicIn = len(paths)
		args = append(args, "-stream_loop", "-1", "-i", sound.music)
	}
	filter := reelFilter(plan) + soundFilter(plan, sound, musicIn, hasIntro)
	args = append(args, "-filter_complex", filter, "-map", "[v]", "-map", "[amix]")
	args = append(args, encodeArgs(r.encoder)...)
	args = append(args, "-movflags", "+faststart", out)
	// AT_CROWD_ONLY=1 (local tests): the reel is already made, only its crowd track is wanted.
	if _, err := os.Stat(out); env("AT_CROWD_ONLY", "") != "1" || err != nil {
		if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
			return nil, fmt.Errorf("ffmpeg reel: %v %s", err, strings.TrimSpace(string(b)))
		}
	}
	if sound.crowd != "" && sound.crowdOut != "" {
		first := 0
		if hasIntro {
			first = 1
		}
		if err := buildCrowdTrack(paths, plan, first, sound, sound.crowdOut); err != nil {
			return nil, fmt.Errorf("crowd: %w", err)
		}
	}
	starts := partStarts(plan)
	if hasIntro {
		starts = starts[1:]
	}
	if recipes != nil {
		o := reelOverlay(recipes, starts, reelLength(plan), sound.outro)
		if sound.restyle != nil {
			sound.restyle(&o)
		}
		recipe := overlayPathOf(dressed)
		if err := o.save(recipe); err != nil {
			return nil, err
		}
		defer os.Remove(recipe)
		if err := r.redress(out, recipe, dressed); err != nil {
			return nil, fmt.Errorf("reel overlay: %w", err)
		}
	}
	return starts, nil
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// buildCrowdTrack renders the reel's crowd alone (crowdTrackFilter) into out,
// an AAC file as long as the reel: sound only, so it takes seconds.
func buildCrowdTrack(paths []string, plan reelPlan, first int, sound reelSound, out string) error {
	length := fmt.Sprintf("%.3f", reelLength(plan))
	dir, err := os.MkdirTemp(filepath.Dir(out), "crowd-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	ffmpeg := func(what string, args ...string) error {
		args = append([]string{"-y", "-hide_banner", "-loglevel", "error"}, args...)
		if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("ffmpeg (%s): %v %s", what, err, strings.TrimSpace(string(b)))
		}
		return nil
	}
	// Each clip's murmur on its own; silence under the intro.
	beds := make([]string, len(plan.durations))
	for i, d := range plan.durations {
		beds[i] = filepath.Join(dir, fmt.Sprintf("bed-%d.wav", i))
		dur := fmt.Sprintf("%.3f", d)
		if i < first {
			if err := ffmpeg("silence", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", dur, "-c:a", "pcm_s16le", beds[i]); err != nil {
				return err
			}
			continue
		}
		start, span := crowdBedSpan(plan, first, i)
		if err := ffmpeg(fmt.Sprintf("murmur %d", i), "-vn", "-i", paths[i],
			"-stream_loop", "-1", "-ss", fmt.Sprintf("%.3f", start), "-t", fmt.Sprintf("%.3f", span+0.2), "-i", sound.crowd,
			"-filter_complex", crowdBedFilter(d), "-map", "[bed]", "-t", dur, "-c:a", "pcm_s16le", beds[i]); err != nil {
			return err
		}
	}
	// Joined the way the clips are (fades, wipes) and the reel ends (outro).
	joined := filepath.Join(dir, "beds.wav")
	args := []string{}
	for _, b := range beds {
		args = append(args, "-i", b)
	}
	audio := plan
	audio.crowd, audio.audioOnly, audio.crowdOnly = nil, true, false
	args = append(args, "-filter_complex", reelFilter(audio), "-map", "[a]", "-t", length, "-c:a", "pcm_s16le", joined)
	if err := ffmpeg("join", args...); err != nil {
		return err
	}
	// Then the reactions over it, each its own stretch of the recording.
	args = []string{"-i", joined}
	var reacts []crowdReact
	for j, r := range crowdReactions(plan, first, sound.reactions) {
		r.in = 1 + j
		reacts = append(reacts, r)
		args = append(args, "-ss", fmt.Sprintf("%.3f", r.from), "-t", fmt.Sprintf("%.3f", r.length), "-i", sound.crowd)
	}
	args = append(args, "-filter_complex", crowdReactsFilter(reacts), "-map", "[crowd]",
		"-t", length, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out)
	return ffmpeg("reactions", args...)
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
