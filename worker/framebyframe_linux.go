package main

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Frame by Frame (github.com/Auto-Tournament/frame-by-frame) is our CS2
// plugin that unhides startmovie: CS2 then writes every frame of a demo and
// its sound itself, at whatever pace the GPU manages. The recorder image ships
// it in fbfSource (recorder.Dockerfile); without it, or when it reports the
// movie commands still hidden (a CS2 update), the recorder captures the
// stream as before. AT_FRAME_BY_FRAME=0 turns it off.

var fbfSource = env("AT_FBF_DIR", "/opt/frame-by-frame")

// fbfGameLine is the search path the plugin loads from, above `Game csgo`.
const fbfGameLine = "Game\tcsgo/frame-by-frame"

var (
	reGameCsgo   = regexp.MustCompile(`^(\s*)Game\s+csgo\s*$`)
	reFbfUnhid   = regexp.MustCompile(`\[Frame by Frame\] movie commands unhidden`)
	reFbfOurLine = regexp.MustCompile(`csgo/frame-by-frame`)
)

func fbfWanted() bool {
	return env("AT_FRAME_BY_FRAME", "1") != "0" && exists(filepath.Join(fbfSource, "bin", "linuxsteamrt64", "libserver.so"))
}

// fbfInstall copies the plugin into the game and adds its search path to
// gameinfo.gi; restore with fbfRestore once CS2 has quit. The line is only
// there while the recorder's CS2 runs: on a PC someone plays on, their CS2
// must start without it.
func fbfInstall(gameDir string) (string, error) {
	dst := filepath.Join(gameDir, "csgo", "frame-by-frame")
	if err := os.RemoveAll(dst); err != nil {
		return "", err
	}
	if err := exec.Command("cp", "-r", fbfSource, dst).Run(); err != nil {
		return "", fmt.Errorf("copy the plugin: %w", err)
	}
	// CS2 writes the frames under the plugin's folder: into RAM when there is
	// some, so the disk's speed does not hold the rendering back. Only a few
	// frames are there at once (fbfConvert takes them as they come).
	if shm := env("AT_FBF_RAM", "/dev/shm"); shm != "off" && exists(shm) {
		ram := filepath.Join(shm, "at-frame-by-frame")
		if err := os.MkdirAll(ram, 0o755); err == nil {
			_ = os.Symlink(ram, filepath.Join(dst, "movie"))
		}
	}
	gi := filepath.Join(gameDir, "csgo", "gameinfo.gi")
	data, err := os.ReadFile(gi)
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(fbfStrip(data)), "\n")
	for i, l := range lines {
		if m := reGameCsgo.FindStringSubmatch(l); m != nil {
			// gameinfo.gi has CRLF line ends: the new line gets the same.
			cr := ""
			if strings.HasSuffix(l, "\r") {
				cr = "\r"
			}
			lines = append(lines[:i], append([]string{m[1] + fbfGameLine + cr}, lines[i:]...)...)
			return gi, os.WriteFile(gi, []byte(strings.Join(lines, "\n")), 0o644)
		}
	}
	return "", errors.New("gameinfo.gi has no `Game csgo` line")
}

// fbfStrip is gameinfo.gi without our search path.
func fbfStrip(data []byte) []byte {
	var out []string
	for _, l := range strings.Split(string(data), "\n") {
		if !reFbfOurLine.MatchString(l) {
			out = append(out, l)
		}
	}
	return []byte(strings.Join(out, "\n"))
}

// fbfRestore takes our search path out of gameinfo.gi again. Run at start too:
// a recorder killed while CS2 ran left it in.
func fbfRestore(gi string) {
	data, err := os.ReadFile(gi)
	if err != nil || !reFbfOurLine.Match(data) {
		return
	}
	if err := os.WriteFile(gi, fbfStrip(data), 0o644); err != nil {
		log.Printf("frame by frame: could not restore %s: %v", gi, err)
	}
}

// fbfUnhidden reports whether startmovie can be used: the plugin says so in
// the game's output as CS2 starts (before the console connects), and `find`
// lists the command once it is no longer hidden. Asked with a demo loaded:
// the movie commands register after the main menu.
func fbfUnhidden(g *game) bool {
	if f, err := os.Open(g.logPath); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			if strings.Contains(sc.Text(), "[Frame by Frame]") {
				log.Printf("%s", strings.TrimSpace(sc.Text()))
			}
			if reFbfUnhid.MatchString(sc.Text()) {
				f.Close()
				return true
			}
		}
		f.Close()
	}
	g.con.drain()
	if err := g.con.send("find startmovie"); err != nil {
		return false
	}
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	for {
		select {
		case line, ok := <-g.con.lines:
			if !ok {
				return false
			}
			// find lists everything that mentions it (movie_fixwave's help
			// does): only a line that starts with the command counts.
			if f := strings.Fields(line); len(f) > 0 && f[0] == "startmovie" {
				log.Printf("frame by frame: find startmovie: %s", strings.TrimSpace(line))
				return true
			}
		case <-timer.C:
			return false
		}
	}
}

// fbfFPS is how many frames a game second CS2 writes where the edit is
// slowed: enough for its slowest part to get a frame of its own for every
// frame of video.
func fbfFPS() float64 {
	return math.Ceil(outputFPS / slowmoSpeed)
}

// fbfRun is a stretch of ticks [from, to) CS2 renders at one rate, as a movie
// of its own; the run-up before the clip is played with no movie.
type fbfRun struct {
	from, to int
	fps      float64
	runUp    bool
}

// fbfMinRun: a stretch at the output's own rate shorter than this goes at the
// slowed rate with its neighbours instead, not worth a movie of its own.
const fbfMinRun = int(tickrate / 4)

// fbfRunUpFPS: the run-up (the camera settling) plays a frame a tick; none of
// it is kept, so it is not in a movie either.
const fbfRunUpFPS = tickrate

// fbfRuns splits ticks from → to (the clip starts at wantFrom; segs are in
// seconds from there) into runs: the run-up, then the slowed rate (fbfFPS)
// wherever any part of a tick is slowed and the output's own rate elsewhere.
// Rendering only the frames a part needs roughly halves a clip's frames.
func fbfRuns(from, wantFrom, to int, segs []segment) []fbfRun {
	normal, slow := math.Ceil(outputFPS), fbfFPS()
	rate := func(t int) float64 {
		a, b := float64(t-wantFrom)/tickrate, float64(t+1-wantFrom)/tickrate
		for _, s := range segs {
			if s.Speed < 1 && s.From < b && s.To > a {
				return slow
			}
		}
		return normal
	}
	merge := func(in []fbfRun) []fbfRun {
		var out []fbfRun
		for _, r := range in {
			if n := len(out); n > 0 && out[n-1].fps == r.fps {
				out[n-1].to = r.to
				continue
			}
			out = append(out, r)
		}
		return out
	}
	start := max(from, wantFrom)
	var clip []fbfRun
	for t := start; t < to; t++ {
		clip = merge(append(clip, fbfRun{from: t, to: t + 1, fps: rate(t)}))
	}
	for i := range clip {
		if clip[i].fps == normal && clip[i].to-clip[i].from < fbfMinRun && i > 0 && i < len(clip)-1 {
			clip[i].fps = slow
		}
	}
	if clip = merge(clip); len(clip) == 0 {
		clip = []fbfRun{{from: start, to: to, fps: normal}}
	}
	clip[len(clip)-1].to = to
	if from < start {
		return append([]fbfRun{{from: from, to: start, fps: fbfRunUpFPS, runUp: true}}, clip...)
	}
	return clip
}

// fbfCapture records analyzer ticks from → to frame by frame and returns the
// clip's frames (timeline over segs, which starts at wantFrom) in a raw I420
// file at raw, holding only the frames the clip uses, plus the sound at wav
// and where wantFrom is in it (seconds). With the plugin's frame actions, each
// run (fbfRuns) is a movie of its own, started on its exact frame; without
// them, it is one movie at the slowed rate from `from`.
func (r *recorder) fbfCapture(g *game, name string, from, to, wantFrom int, segs []segment, raw, wav string) ([]frameRef, float64, error) {
	if g.lastTick > 0 && to > g.lastTick-endMargin {
		to = g.lastTick - endMargin
	}
	if err := g.con.send("host_timescale 1", "host_framerate 0", "fps_max 0", "demo_timescale 1"); err != nil {
		return nil, 0, err
	}
	if err := g.seekForCapture(max(0, from), 1); err != nil {
		return nil, 0, err
	}
	if err := g.spectate(name); err != nil {
		return nil, 0, err
	}
	time.Sleep(500 * time.Millisecond)
	if err := g.spectate(name); err != nil {
		return nil, 0, err
	}
	if err := g.checkFollow(name, from); err != nil {
		return nil, 0, err
	}
	// Spectating can set the demo playing again: stop it and take the tick it
	// stopped on, or the clip's timing is planned from the seek's tick while
	// the demo is already past it.
	if t, ok := g.pausedTick(); ok {
		g.pausedAt = t
	}
	// Each follow-check retry spectates again, and the demo plays on meanwhile:
	// one retry took it 48 ticks past the run-up into the clip, whose first
	// frames were then never captured (2026-10-24, "no frame near tick" on
	// every attempt). Seek back; the camera stays on the player.
	if g.pausedAt > from+lead/2 {
		log.Printf("frame by frame: the demo played on to tick %d while following; seeking back to %d", g.pausedAt, from)
		if err := g.seekForCapture(max(0, from), 1); err != nil {
			return nil, 0, err
		}
	}
	csgo := filepath.Join(r.gameDir, "csgo")
	actions := r.fbfActions(g)
	runs := []fbfRun{{from: g.pausedAt, to: to, fps: fbfFPS()}}
	if actions {
		runs = fbfRuns(g.pausedAt, wantFrom, to, segs)
	}
	// Each run's frames, planned from where the demo stands; the last one through `to`.
	counts := make([]int, len(runs))
	at := float64(g.pausedAt)
	for k, run := range runs {
		step := tickrate / run.fps
		if k < len(runs)-1 {
			counts[k] = int(math.Round((float64(run.to) - at) / step))
		} else {
			counts[k] = int(math.Ceil((float64(to)-at)/step)) + 1
		}
		at += float64(counts[k]) * step
	}
	stamp := time.Now().UnixNano()
	movies := make([]string, len(runs))
	for k, run := range runs {
		if !run.runUp {
			movies[k] = fmt.Sprintf("atfbf%d_%d_", stamp, k)
			defer fbfCleanMovie(csgo, movies[k])
		}
	}
	g.con.drain()
	// The movie and the resume on the same frame, so no frames of the paused
	// demo go first and frame i is i/fps game seconds after the resume.
	if actions {
		if err := writeFbfActions(csgo, fbfPlan(runs, counts, movies)); err != nil {
			return nil, 0, err
		}
		defer func() { _ = writeFbfActions(csgo, "") }()
	} else if err := g.con.send(fmt.Sprintf("host_framerate %g", runs[0].fps), fmt.Sprintf("demo_pauseatservertick %d", g.startTick+to),
		fmt.Sprintf("startmovie %s tga wav; demo_resume", movies[0])); err != nil {
		return nil, 0, err
	}
	t0 := g.pausedAt
	if v, _, err := g.con.expect(reUnpaused, 5*time.Second); err == nil {
		t, _ := strconv.Atoi(v)
		t0 = t - g.startTick
	} else {
		// It plays on from where the seek paused it; CS2 does not always say so.
		log.Printf("frame by frame: no word of the resume; going from the seek's tick %d", t0)
	}
	// The frames were planned from pausedAt: from anywhere else, every one is off.
	if d := t0 - g.pausedAt; d > 2 || d < -2 {
		_ = g.con.send("endmovie", "host_framerate 0", "demo_pause")
		return nil, 0, fmt.Errorf("the demo resumed at tick %d, not %d as planned", t0, g.pausedAt)
	}
	_ = g.spectate(name)

	// Every kept frame's place in the game: each movie from where the runs
	// before it took the demo, at its own rate.
	var ticks []float64
	firsts := make([]int, len(runs)+1) // the run's first frame among ticks
	at = float64(t0)
	for k, run := range runs {
		firsts[k] = len(ticks)
		step := tickrate / run.fps
		if !run.runUp {
			for i := 0; i < counts[k]; i++ {
				ticks = append(ticks, at+float64(i)*step)
			}
		}
		at += float64(counts[k]) * step
	}
	firsts[len(runs)] = len(ticks)
	frames, err := timeline([][]float64{ticks}, segs, wantFrom)
	if err != nil {
		_ = g.con.send("endmovie", "host_framerate 0", "demo_pause")
		return nil, 0, err
	}
	// Each used frame's place in raw, in order (timeline's frames only go forward).
	keep := map[int]int{}
	var order []int
	for _, f := range frames {
		for _, i := range []int{f.index, f.next} {
			if _, ok := keep[i]; i >= 0 && !ok {
				keep[i] = 0
				order = append(order, i)
			}
		}
	}
	sort.Ints(order)
	for k, i := range order {
		keep[i] = k
	}
	for k := range frames {
		frames[k].index = keep[frames[k].index]
		if frames[k].next >= 0 {
			frames[k].next = keep[frames[k].next]
		}
	}

	ff := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "rawvideo", "-pix_fmt", "bgr24", "-s", fmt.Sprintf("%dx%d", g.width, g.height), "-i", "pipe:0",
		"-pix_fmt", "yuv420p", "-f", "rawvideo", raw)
	stdin, err := ff.StdinPipe()
	if err != nil {
		return nil, 0, err
	}
	var stderr strings.Builder
	ff.Stderr = &stderr
	if err := ff.Start(); err != nil {
		return nil, 0, err
	}
	defer func() {
		if ff.ProcessState == nil {
			stdin.Close()
			_ = ff.Wait()
		}
	}()
	stop := func() { _ = g.con.send("endmovie", "host_framerate 0", "demo_pause") }

	began := time.Now()
	rendered := 0
	var sounds []string
	for k, run := range runs {
		if run.runUp {
			continue
		}
		var use []int
		for _, i := range order {
			if i >= firsts[k] && i < firsts[k+1] {
				use = append(use, i-firsts[k])
			}
		}
		// CS2 renders slower than real time (10 frames a second at least): the
		// movie's end comes when it gets there.
		deadline := time.Now().Add(time.Duration(float64(counts[k])/10*float64(time.Second)) + time.Minute)
		// The movie ended (frame actions), the demo paused (no actions), CS2
		// gone or the job cancelled: no more frames are coming.
		ended := regexp.MustCompile(`(?:^|[^n])paused on tick (\d+)`)
		if actions {
			ended = regexp.MustCompile(`Finishing movie: .*` + movies[k] + `()`)
		}
		finished := false // CS2 says it once, and the converter may be the one to hear it
		done := func() bool {
			if finished {
				return true
			}
			_, _, err := g.con.expect(ended, 50*time.Millisecond)
			finished = err == nil
			return err == nil || errors.Is(err, errConsoleClosed) || (r.jobContext != nil && r.jobContext.Err() != nil)
		}
		base, total := float64(firsts[k]), float64(len(ticks))
		n := float64(firsts[k+1] - firsts[k])
		progress := func(frac float64) { r.reportPart((base + frac*n) / total) }
		got, convErr := fbfConvert(csgo, movies[k], use, g.width, g.height, stdin, done, deadline, progress)
		rendered += got
		if !actions {
			// The last frame the clip uses is in: CS2 has played (and recorded
			// the sound) at least that far, so the movie stops there.
			stop()
		}
		if convErr != nil {
			stop()
			return nil, 0, fmt.Errorf("frame by frame: %w", convErr)
		}
		if actions {
			// The plugin ends the movie on its frame: wait for it, for its sound.
			for !done() {
				if time.Now().After(deadline) {
					stop()
					return nil, 0, fmt.Errorf("frame by frame: movie %d did not end", k)
				}
			}
		}
		path, err := fbfWav(csgo, movies[k])
		if err != nil {
			return nil, 0, err
		}
		sounds = append(sounds, path)
	}
	stdin.Close()
	if err := ff.Wait(); err != nil {
		return nil, 0, fmt.Errorf("frame by frame: ffmpeg: %v %s", err, strings.TrimSpace(stderr.String()))
	}
	if err := joinSounds(sounds, wav); err != nil {
		return nil, 0, err
	}
	took := time.Since(began).Seconds()
	log.Printf("frame by frame: ticks %d → %d in %d run(s), %d of %d frames used; %d rendered in %.1f s (%.0f a second)",
		t0, to, len(runs), len(order), len(ticks), rendered, took, float64(rendered)/took)
	// The sound starts where the first movie does: after the run-up, if any.
	soundFrom := float64(t0)
	if runs[0].runUp {
		soundFrom += float64(counts[0]) * tickrate / runs[0].fps
	}
	return frames, (float64(wantFrom) - soundFrom) / tickrate, nil
}

// fbfPlan is the actions file (the plugin's frame_hook) for runs of `counts`
// frames: the first starts on frame 0 with the demo's resume, each next one on
// the frame the one before ends, and after the last the demo pauses.
func fbfPlan(runs []fbfRun, counts []int, movies []string) string {
	var b strings.Builder
	frame := 0
	for k, run := range runs {
		if k > 0 && !runs[k-1].runUp {
			fmt.Fprintf(&b, "%d endmovie\n", frame)
		}
		fmt.Fprintf(&b, "%d host_framerate %g\n", frame, run.fps)
		resume := ""
		if k == 0 {
			resume = "; demo_resume"
		}
		if run.runUp {
			fmt.Fprintf(&b, "%d demo_resume\n", frame)
		} else {
			fmt.Fprintf(&b, "%d startmovie %s tga wav%s\n", frame, movies[k], resume)
		}
		frame += counts[k]
	}
	fmt.Fprintf(&b, "%d endmovie\n%d host_framerate 0\n%d demo_pause\n", frame, frame, frame)
	return b.String()
}

// writeFbfActions replaces the plugin's actions file in one step: the plugin
// reads a new file from its frame 0.
func writeFbfActions(csgo, plan string) error {
	path := filepath.Join(csgo, "frame-by-frame", "actions.txt")
	if err := os.WriteFile(path+".tmp", []byte(plan), 0o644); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

// cs2Version is the installed CS2's patch version (csgo/steam.inf), or "".
func cs2Version(gameDir string) string {
	data, err := os.ReadFile(filepath.Join(gameDir, "csgo", "steam.inf"))
	if err != nil {
		return ""
	}
	for _, l := range strings.Split(string(data), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(l), "PatchVersion="); ok {
			return v
		}
	}
	return ""
}

// fbfActions reports whether the plugin runs frame actions in this CS2 (its
// frame hook is on), asked once a session with an echo.
func (r *recorder) fbfActions(g *game) bool {
	if g.fbfActionsChecked {
		return g.fbfActionsOn
	}
	g.fbfActionsChecked = true
	if env("AT_FBF_ACTIONS", "1") == "0" {
		return false
	}
	csgo := filepath.Join(r.gameDir, "csgo")
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	g.con.drain()
	if err := writeFbfActions(csgo, "0 echo [Frame by Frame] actions "+nonce+"\n"); err != nil {
		return false
	}
	_, _, err := g.con.expect(regexp.MustCompile(`actions `+nonce+`()`), 3*time.Second)
	if g.fbfActionsOn = err == nil; g.fbfActionsOn {
		log.Printf("frame by frame: frame actions on")
		setFbfReport("actions", cs2Version(r.gameDir))
	} else {
		log.Printf("frame by frame: no frame actions (the plugin's frame hook is off); one movie at the slowed rate")
		setFbfReport("movie", cs2Version(r.gameDir))
	}
	return g.fbfActionsOn
}

// fbfWav is the sound CS2 wrote for a movie, once endmovie has finished it.
func fbfWav(csgo, movie string) (string, error) {
	wavs, _ := filepath.Glob(filepath.Join(csgo, "*", "movie", "*", movie+"*.wav"))
	more, _ := filepath.Glob(filepath.Join(csgo, "movie", "*", movie+"*.wav"))
	if wavs = append(wavs, more...); len(wavs) == 0 {
		return "", errors.New("frame by frame: CS2 wrote no sound")
	}
	// endmovie finishes the WAV: wait for its size to settle.
	for last, tries := int64(-1), 0; tries < 30; tries++ {
		time.Sleep(300 * time.Millisecond)
		st, err := os.Stat(wavs[0])
		if err == nil && st.Size() == last {
			break
		}
		if err == nil {
			last = st.Size()
		}
	}
	return wavs[0], nil
}

// joinSounds writes the movies' sound one after another into out: each one
// is exactly as long as its frames.
func joinSounds(paths []string, out string) error {
	if len(paths) == 1 {
		return copyFile(paths[0], out)
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	var labels strings.Builder
	for i, p := range paths {
		args = append(args, "-i", p)
		fmt.Fprintf(&labels, "[%d:a]", i)
	}
	args = append(args, "-filter_complex", fmt.Sprintf("%sconcat=n=%d:v=0:a=1[a]", labels.String(), len(paths)),
		"-map", "[a]", "-c:a", "pcm_s16le", out)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("frame by frame: joining the sound: %v %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}

// fbfConvert writes a movie's TGA frames to out as BGR24 as CS2 writes them:
// the frames in `use` (by number, ascending) go in, the others are deleted
// unread, so the disk only ever holds a few. paused reports whether CS2 got to
// the end (ended): frames after that are not waited for.
func fbfConvert(csgo, movie string, use []int, w, h int, out io.Writer, paused func() bool, deadline time.Time, progress func(float64)) (rendered int, werr error) {
	if len(use) == 0 {
		return 0, nil
	}
	ended := false
	want := map[int]bool{}
	last := -1
	for _, i := range use {
		want[i] = true
		last = max(last, i)
	}
	next := last // the next frame number wanted in order: the first one
	for _, i := range use {
		next = min(next, i)
	}
	first := next
	base := -1
	started := time.Now()
	for next <= last && werr == nil {
		files := fbfFrames(csgo, movie)
		// CS2 numbers from 0 or 1: count from the first it wrote.
		if base < 0 && len(files) > 0 {
			base = files[0].num
		}
		for i := range files {
			files[i].num -= base
		}
		// A frame is complete once the one after it exists (or CS2 stopped).
		for len(files) > 0 && (len(files) > 1 || ended) && next <= last {
			num := files[0].num
			if want[num] {
				if num != next {
					werr = fmt.Errorf("frame %d missing (got %d)", next, num)
					break
				}
				if werr = tgaToBGR(files[0].path, w, h, out); werr != nil {
					break
				}
				for next++; next <= last && !want[next]; next++ {
				}
			}
			rendered = max(rendered, num+1)
			os.Remove(files[0].path)
			files = files[1:]
		}
		if last > first {
			progress(float64(next-first) / float64(last-first))
		}
		if werr != nil || next > last {
			break
		}
		if ended {
			if len(fbfFrames(csgo, movie)) == 0 {
				werr = fmt.Errorf("CS2 stopped at frame %d of %d", next, last)
			}
			continue
		}
		if time.Now().After(deadline) || (base < 0 && time.Since(started) > 30*time.Second) {
			werr = fmt.Errorf("CS2 did not get past frame %d of %d in time (movie folders hold: %s)", next, last, fbfMovieFiles(csgo))
			break
		}
		ended = paused()
	}
	return rendered, werr
}

type fbfFrame struct {
	path string
	num  int
}

// fbfFrames is the movie's TGA frames on disk, in order.
func fbfFrames(csgo, movie string) []fbfFrame {
	paths, _ := filepath.Glob(filepath.Join(csgo, "*", "movie", "*", movie+"*.tga"))
	more, _ := filepath.Glob(filepath.Join(csgo, "movie", "*", movie+"*.tga"))
	var out []fbfFrame
	for _, p := range append(paths, more...) {
		// <movie><frame number>.tga: the movie's own name is digits too.
		num := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(p), movie), ".tga")
		if n, err := strconv.Atoi(num); err == nil {
			out = append(out, fbfFrame{p, n})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].num < out[j].num })
	return out
}

// fbfMovieFiles names a few files in the movie folders, for an error.
func fbfMovieFiles(csgo string) string {
	a, _ := filepath.Glob(filepath.Join(csgo, "*", "movie", "*", "*"))
	b, _ := filepath.Glob(filepath.Join(csgo, "movie", "*", "*"))
	all := append(a, b...)
	if len(all) > 5 {
		all = all[len(all)-5:]
	}
	for i := range all {
		all[i] = strings.TrimPrefix(all[i], csgo+"/")
	}
	if len(all) == 0 {
		return "nothing"
	}
	return strings.Join(all, ", ")
}

// fbfCleanMovie deletes what is left of a movie (its frames and sound).
func fbfCleanMovie(csgo, movie string) {
	for _, pattern := range []string{filepath.Join(csgo, "*", "movie", "*", movie+"*"), filepath.Join(csgo, "movie", "*", movie+"*")} {
		paths, _ := filepath.Glob(pattern)
		for _, p := range paths {
			os.Remove(p)
		}
	}
}

// tgaToBGR writes an uncompressed 24- or 32-bit TGA of w×h as top-down BGR24.
func tgaToBGR(path string, w, h int, out io.Writer) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(data) < 18 {
		return fmt.Errorf("%s: not a TGA", path)
	}
	idLen, kind, bpp, desc := int(data[0]), data[2], int(data[16]), data[17]
	tw, th := int(binary.LittleEndian.Uint16(data[12:])), int(binary.LittleEndian.Uint16(data[14:]))
	if kind != 2 || (bpp != 24 && bpp != 32) || tw != w || th != h {
		return fmt.Errorf("%s: TGA type %d, %d bits, %dx%d (want uncompressed, 24/32 bits, %dx%d)", path, kind, bpp, tw, th, w, h)
	}
	px := data[18+idLen:]
	step := bpp / 8
	if len(px) < w*h*step {
		return fmt.Errorf("%s: short TGA", path)
	}
	row := make([]byte, w*3)
	topDown := desc&0x20 != 0
	for y := 0; y < h; y++ {
		src := y
		if !topDown {
			src = h - 1 - y
		}
		line := px[src*w*step : (src+1)*w*step]
		if step == 3 {
			copy(row, line)
		} else {
			for x := 0; x < w; x++ {
				copy(row[x*3:x*3+3], line[x*4:x*4+3])
			}
		}
		if _, err := out.Write(row); err != nil {
			return err
		}
	}
	return nil
}
