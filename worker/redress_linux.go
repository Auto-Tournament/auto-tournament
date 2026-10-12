//go:build linux

package main

// Redress: a video dressed again from its clean twin and its overlay's
// recipe (overlay.go), no CS2 needed: one decode, the card and kill feed drawn
// over it, one encode. `at-worker redress <clean.mp4> <overlay.json> <out.mp4>`
// does it for local files.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

func (r *recorder) redress(clean, recipe, out string) error {
	_, err := r.dress(clean, recipe, out, false)
	return err
}

// redressClip dresses a clip to be watched on its own (standalone.go): no
// caption card, from where its slowed opening ends. It returns that start.
func (r *recorder) redressClip(clean, recipe, out string) (float64, error) {
	return r.dress(clean, recipe, out, true)
}

func (r *recorder) dress(clean, recipe, out string, alone bool) (float64, error) {
	o, err := loadOverlay(recipe)
	if err != nil {
		return 0, err
	}
	start := 0.0
	if alone {
		start = standaloneStart(o)
		o = withoutCards(o)
	}
	if err := r.overlayTools(); err != nil {
		return 0, err
	}
	// As long as the clean video, to the frame (the overlay's streams are cut there).
	length, err := probeDuration(clean)
	if err != nil {
		return 0, err
	}
	o.Duration = math.Max(o.Duration, length)
	track, err := newOverlayTrack(o, r.icons)
	if err != nil {
		return 0, err
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", clean}
	ov := overlay{card: -1, feed: -1, logo: -1, width: o.Width, height: o.Height}
	ov.blur = gpuBlur(r.encoder)
	for _, p := range o.Parts {
		if p.Card != nil && !p.Settled {
			ov.focus = append(ov.focus, p.Start)
		}
	}
	next := 1
	type stream struct {
		pipe  string
		frame func(at float64) []byte
	}
	var streams []stream
	pipe := func(name string, box string, frame func(float64) []byte) (int, error) {
		p := out + "." + name
		_ = os.Remove(p)
		if err := syscall.Mkfifo(p, 0o600); err != nil {
			return 0, fmt.Errorf("%s pipe: %w", name, err)
		}
		args = append(args, "-f", "rawvideo", "-pix_fmt", "rgba", "-s", box, "-framerate", fmt.Sprint(cardFPS), "-i", p)
		streams = append(streams, stream{p, frame})
		next++
		return next - 1, nil
	}
	if !track.cardBox.Empty() {
		if ov.card, err = pipe("card", fmt.Sprintf("%dx%d", track.cardBox.Dx(), track.cardBox.Dy()), track.cardFrame); err != nil {
			return 0, err
		}
		ov.cardAt = track.cardBox.Min
	}
	if !track.feedBox.Empty() {
		// Its own buffer: the two streams are written at once.
		feedTrack := *track
		feedTrack.frame = cloneRGBA(track.frame)
		if ov.feed, err = pipe("feed", fmt.Sprintf("%dx%d", track.feedBox.Dx(), track.feedBox.Dy()), feedTrack.feedFrame); err != nil {
			return 0, err
		}
		ov.feedAt = track.feedBox
	}
	for _, s := range streams {
		defer os.Remove(s.pipe)
	}
	if o.Logo {
		args = append(args, "-loop", "1", "-framerate", fmt.Sprint(outputFPS), "-i", r.logo)
		ov.logo = next
	}
	args = append(args, "-filter_complex", videoFilter(ov), "-map", "[v]", "-map", "0:a?")
	args = append(args, encodeArgs(r.encoder)...)
	if start > 0 {
		// Dressed from the start (the kill feed's frames line up with the
		// video's), and only what comes after `start` kept.
		args = append(args, "-ss", fmt.Sprintf("%.4f", start))
	}
	args = append(args, "-t", fmt.Sprintf("%.4f", length-start), "-c:a", "copy", "-movflags", "+faststart", out)
	cmd := exec.CommandContext(r.commandContext(), "ffmpeg", hwEncode(blurArgs(ov.blur, args), r.encoder)...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	done := make(chan error, len(streams))
	frames := track.Frames()
	for _, s := range streams {
		go func(s stream) {
			done <- streamFrames(s.pipe, frames, func(i int) []byte { return s.frame(float64(i) / cardFPS) })
		}(s)
	}
	waitErr := cmd.Wait()
	var errs []error
	for _, s := range streams {
		// ffmpeg gone before it opened a pipe: open the other end so its writer stops waiting.
		if f, err := os.OpenFile(s.pipe, os.O_RDONLY|syscall.O_NONBLOCK, 0); err == nil {
			f.Close()
		}
	}
	for range streams {
		if err := <-done; err != nil && !strings.Contains(err.Error(), "broken pipe") {
			errs = append(errs, err)
		}
	}
	if waitErr != nil {
		return 0, fmt.Errorf("ffmpeg: %v %s", waitErr, strings.TrimSpace(stderr.String()))
	}
	return start, errors.Join(errs...)
}

// redressFile is `at-worker redress <clean.mp4> <overlay.json> <out.mp4>`.
func redressFile(args []string) error {
	if len(args) != 3 {
		return errors.New("usage: at-worker redress <clean.mp4> <overlay.json> <out.mp4>")
	}
	r, err := newRecorder(nil)
	if err != nil {
		return err
	}
	return r.redress(args[0], args[1], args[2])
}

// clipFile is a clip's file name on the platform (a reel's starts with its kind).
var clipFile = regexp.MustCompile(`^\d+\.mp4$`)

// redressJob is a batch of the platform's videos to dress again.
type redressJob struct {
	Kind  string `json:"kind"`
	Files []struct {
		File   string `json:"file"`
		URL    string `json:"url"`
		Upload string `json:"upload"`
		Fail   string `json:"fail"`
	} `json:"files"`
}

// runRedress downloads each video's clean twin and recipe, dresses it and
// sends it back; one that fails is reported and the rest go on.
func (r *recorder) runRedress(ctx context.Context, j *redressJob) {
	dir, err := os.MkdirTemp(r.scratch, "redress-")
	if err != nil {
		log.Printf("redress: %v", err)
		return
	}
	defer os.RemoveAll(dir)
	started := time.Now()
	done := 0
	for i, f := range j.Files {
		if ctx.Err() != nil {
			return
		}
		r.report("redressing", f.File, i, len(j.Files))
		local := filepath.Join(dir, fmt.Sprintf("v%d.mp4", i))
		out := filepath.Join(dir, fmt.Sprintf("v%d-dressed.mp4", i))
		err := func() error {
			r.downloadTwins(ctx, f.URL, local)
			if !exists(cleanPathOf(local)) {
				return errors.New("no clean twin or overlay recipe")
			}
			// A clip (`<id>.mp4`) is watched on its own: no card, and the
			// platform is told where it now starts (standalone.go).
			if clipFile.MatchString(f.File) {
				start, err := r.redressClip(cleanPathOf(local), overlayPathOf(local), out)
				if err != nil {
					return err
				}
				res, err := r.sendFile(ctx, out, f.Upload, "video/mp4", map[string]string{"X-AT-Start": fmt.Sprintf("%.2f", start)})
				if err != nil {
					return err
				}
				defer res.Body.Close()
				return ok(res, "upload "+f.File)
			}
			if err := r.redress(cleanPathOf(local), overlayPathOf(local), out); err != nil {
				return err
			}
			return r.putFile(ctx, out, f.Upload, "video/mp4")
		}()
		for _, p := range []string{cleanPathOf(local), overlayPathOf(local), out} {
			os.Remove(p)
		}
		if err != nil {
			log.Printf("redress %s: %v", f.File, err)
			msg := err.Error()
			if len(msg) > 500 {
				msg = msg[:500]
			}
			if res, perr := r.postJSON(context.Background(), f.Fail, map[string]any{"error": msg}); perr == nil {
				res.Body.Close()
			}
			continue
		}
		done++
	}
	log.Printf("redressed %d of %d video(s) in %s", done, len(j.Files), time.Since(started).Round(time.Second))
}

// overlayTools makes sure a recorder made without newRecorder (join-reel) has
// the logo and the kill feed's icons (from AT_CS2_GAME's CS2) to draw with.
func (r *recorder) overlayTools() error {
	dir := r.scratch
	if dir == "" {
		dir = env("AT_RECORD_DIR", os.TempDir())
	}
	if r.logo == "" {
		r.logo = filepath.Join(dir, "at-watermark.png")
		if err := os.WriteFile(r.logo, watermarkPNG, 0o644); err != nil {
			return err
		}
	}
	if r.icons == nil {
		if game := env("AT_CS2_GAME", ""); game != "" {
			hud := filepath.Join(dir, "hud")
			if _, err := exportHud(filepath.Join(game, "csgo"), hud, map[string]bool{"weapons": true, "deathnotice": true}); err == nil {
				r.icons = newIconSet(hud)
			}
		}
	}
	return nil
}
