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
	gi := filepath.Join(gameDir, "csgo", "gameinfo.gi")
	data, err := os.ReadFile(gi)
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(fbfStrip(data)), "\n")
	for i, l := range lines {
		if m := reGameCsgo.FindStringSubmatch(l); m != nil {
			lines = append(lines[:i], append([]string{m[1] + fbfGameLine}, lines[i:]...)...)
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

// fbfUnhidden reports whether the plugin said it unhid the movie commands:
// it says so in the game's output (the gamescope log) as CS2 starts.
func fbfUnhidden(logPath string) bool {
	f, err := os.Open(logPath)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if reFbfUnhid.MatchString(sc.Text()) {
			return true
		}
	}
	return false
}

// fbfFPS is how many frames a game second CS2 writes: enough for the slowest
// part of the edit to get a frame of its own for every frame of video.
func fbfFPS() float64 {
	return math.Ceil(outputFPS / slowmoSpeed)
}

// fbfCapture records analyzer ticks from → to frame by frame and returns the
// clip's frames (timeline over segs, which starts at wantFrom) in a raw I420
// file at raw, holding only the frames the clip uses, plus the sound at wav
// and where wantFrom is in it (seconds).
func (r *recorder) fbfCapture(g *game, name string, from, to, wantFrom int, segs []segment, raw, wav string) ([]frameRef, float64, error) {
	if g.lastTick > 0 && to > g.lastTick-endMargin {
		to = g.lastTick - endMargin
	}
	fps := fbfFPS()
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
	movie := fmt.Sprintf("atfbf%d", time.Now().UnixNano())
	csgo := filepath.Join(r.gameDir, "csgo")
	defer fbfCleanMovie(csgo, movie)
	g.con.drain()
	// startmovie and the resume on one line: the same frame, so no frames of
	// the paused demo go first and frame i is i/fps game seconds after the resume.
	if err := g.con.send(fmt.Sprintf("host_framerate %g", fps), fmt.Sprintf("demo_pauseatservertick %d", g.startTick+to),
		fmt.Sprintf("startmovie %s tga wav; demo_resume", movie)); err != nil {
		return nil, 0, err
	}
	v, _, err := g.con.expect(reUnpaused, 10*time.Second)
	if err != nil {
		_ = g.con.send("endmovie", "host_framerate 0")
		return nil, 0, fmt.Errorf("frame by frame: %w", err)
	}
	t0, _ := strconv.Atoi(v)
	t0 -= g.startTick
	_ = g.spectate(name)

	// Which frames the clip uses, from where each one is in the game.
	n := int(math.Ceil(float64(to-t0)/tickrate*fps)) + 1
	ticks := make([]float64, n)
	for i := range ticks {
		ticks[i] = float64(t0) + float64(i)*tickrate/fps
	}
	frames, err := timeline([][]float64{ticks}, segs, wantFrom)
	if err != nil {
		_ = g.con.send("endmovie", "host_framerate 0")
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

	// CS2 renders slower than real time (10 frames a second at least): the
	// pause at `to` comes when it gets there.
	deadline := time.Now().Add(time.Duration(float64(n)/10*float64(time.Second)) + time.Minute)
	paused := func() bool {
		_, _, err := g.con.expect(rePaused, 50*time.Millisecond)
		return err == nil
	}
	ended, convErr := fbfConvert(csgo, movie, order, g.width, g.height, raw, paused, deadline)
	// The frames past the clip's last are not needed, but the sound is up to `to`.
	for !ended && convErr == nil && time.Now().Before(deadline) {
		ended = paused()
	}
	_ = g.con.send("endmovie", "host_framerate 0")
	if convErr != nil {
		_ = g.pause()
		return nil, 0, fmt.Errorf("frame by frame: %w", convErr)
	}
	wavs, _ := filepath.Glob(filepath.Join(csgo, "*", "movie", "*", movie+"*.wav"))
	more, _ := filepath.Glob(filepath.Join(csgo, "movie", "*", movie+"*.wav"))
	if wavs = append(wavs, more...); len(wavs) == 0 {
		return nil, 0, errors.New("frame by frame: CS2 wrote no sound")
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
	if err := copyFile(wavs[0], wav); err != nil {
		return nil, 0, err
	}
	log.Printf("frame by frame: ticks %d → %d at %g frames a game second, %d of %d frames used", t0, to, fps, len(order), n)
	return frames, float64(wantFrom-t0) / tickrate, nil
}

// fbfConvert turns the movie's TGA frames into one raw I420 file as CS2 writes
// them: the frames in `use` (by number, ascending) go in, the others are
// deleted unread, so the disk only ever holds a few. paused reports whether
// CS2 got to the end (ended): frames after that are not waited for.
func fbfConvert(csgo, movie string, use []int, w, h int, raw string, paused func() bool, deadline time.Time) (ended bool, werr error) {
	ff := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "rawvideo", "-pix_fmt", "bgr24", "-s", fmt.Sprintf("%dx%d", w, h), "-i", "pipe:0",
		"-pix_fmt", "yuv420p", "-f", "rawvideo", raw)
	stdin, err := ff.StdinPipe()
	if err != nil {
		return false, err
	}
	var stderr strings.Builder
	ff.Stderr = &stderr
	if err := ff.Start(); err != nil {
		return false, err
	}
	want := map[int]bool{}
	last := -1
	for _, i := range use {
		want[i] = true
		last = max(last, i)
	}
	next := 0 // the next frame number wanted in order
	base := -1
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
				if werr = tgaToBGR(files[0].path, w, h, stdin); werr != nil {
					break
				}
				for next++; next <= last && !want[next]; next++ {
				}
			}
			os.Remove(files[0].path)
			files = files[1:]
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
		if time.Now().After(deadline) {
			werr = fmt.Errorf("CS2 got to frame %d of %d in time", next, last)
			break
		}
		ended = paused()
	}
	stdin.Close()
	if err := ff.Wait(); err != nil && werr == nil {
		werr = fmt.Errorf("ffmpeg: %v %s", err, strings.TrimSpace(stderr.String()))
	}
	return ended, werr
}

type fbfFrame struct {
	path string
	num  int
}

var reFrameNum = regexp.MustCompile(`(\d+)\.tga$`)

// fbfFrames is the movie's TGA frames on disk, in order.
func fbfFrames(csgo, movie string) []fbfFrame {
	paths, _ := filepath.Glob(filepath.Join(csgo, "*", "movie", "*", movie+"*.tga"))
	more, _ := filepath.Glob(filepath.Join(csgo, "movie", "*", movie+"*.tga"))
	var out []fbfFrame
	for _, p := range append(paths, more...) {
		if m := reFrameNum.FindStringSubmatch(p); m != nil {
			n, _ := strconv.Atoi(m[1])
			out = append(out, fbfFrame{p, n})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].num < out[j].num })
	return out
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
