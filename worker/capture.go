//go:build linux

package main

// The CS2 side of the recorder: CS2 runs inside a headless gamescope, which
// hands its frames out as a PipeWire video stream; the recorder drives the
// demo over CS2's console port (-netconport). CS2 has no frame dump of its
// own (`startmovie` is gone), so a moment is captured live, twice:
//
//   - the picture slowed down (demo_timescale), in one pass per window that
//     slows further for the caption card's opening and the slow motion:
//     gamescope's stream gives ~30 frames a second whatever CS2 draws, so the
//     speeds follow from the frames the clip needs (captureSpeeds);
//   - the sound at real speed, from the audio sink CS2 plays into.
//
// Which frame shows which tick: the console says where the demo resumed and
// paused ("unpaused on tick N", "paused on tick N"); the demo plays at a
// steady rate between, so a frame's tick follows from when it arrived.
//
// Needs gamescope, gst-launch-1.0 (pipewiresrc), pw-link, pw-record and Steam
// running with the bot account signed in (CS2 asks it for a ticket).

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	netconPort = 2121
	seekPoll   = 500 * time.Millisecond
	endMargin  = tickrate // ticks kept clear of the demo's end
)

// frameSettleMs is how long the view gets to settle after a seek before the
// picture counts (AT_SETTLE_MS).
var frameSettleMs = envPositive("AT_SETTLE_MS", 700)

// recorderLook is what every clip is played with: only the kill feed and the
// crosshair on screen, no x-ray, no demo controls; the crosshair is the
// recorder's own (AT_CROSSHAIR_CFG replaces it), not the player's.
var recorderLook = []string{
	"demo_ui_mode 0",
	"cl_draw_only_deathnotices 1",
	"spec_show_xray 0",
	"cl_show_observer_crosshair 0",
	"cl_trueview_show_status 0",
	"r_show_build_info 0",
	"hud_showtargetid 0",
	"volume 1",
	"fps_max 0",
	// A static cross with a dot, green-cyan, no outline.
	"cl_crosshairstyle 4", "cl_crosshairdot 1", "cl_crosshair_recoil 0", "cl_crosshair_t 0",
	"cl_crosshair_length 2", "cl_crosshair_thickness 1", "cl_crosshair_gap 2",
	"cl_crosshair_drawoutline 0", "cl_crosshair_screen_height 960",
	"cl_crosshaircolor_r 0", "cl_crosshaircolor_g 255", "cl_crosshaircolor_b 168", "cl_crosshaircolor_a 255",
	"cl_crosshair_dynamic_splitdist 3", "cl_crosshair_dynamic_splitalpha_innermod 0",
	"cl_crosshair_dynamic_splitalpha_outermod 1", "cl_crosshair_dynamic_maxdist_splitratio 1",
}

var (
	reUnpaused  = regexp.MustCompile(`unpaused on tick (\d+)`)
	rePaused    = regexp.MustCompile(`(?:^|[^n])paused on tick (\d+)`)
	reStartTick = regexp.MustCompile(`server_start_tick: (\d+)`)
	reLastTick  = regexp.MustCompile(`playback_ticks: (\d+)`)
	reMapLoaded = regexp.MustCompile(`OnSwitchLoopModeFinished\( (game) : success \)`)
	reNode      = regexp.MustCompile(`stream available on node ID: (\d+)`)
)

// console is CS2's console over TCP: commands in, every output line to `lines`.
type console struct {
	conn  net.Conn
	mu    sync.Mutex
	lines chan string
}

// dialConsole connects to CS2's console; every line it prints is also
// appended to logPath.
func dialConsole(ctx context.Context, wait time.Duration, logPath string) (*console, error) {
	deadline := time.Now().Add(wait)
	for {
		var d net.Dialer
		conn, err := d.DialContext(ctx, "tcp", fmt.Sprintf("127.0.0.1:%d", netconPort))
		if err == nil {
			c := &console{conn: conn, lines: make(chan string, 4096)}
			logFile, _ := os.Create(logPath)
			go func() {
				if logFile != nil {
					defer logFile.Close()
				}
				sc := bufio.NewScanner(conn)
				sc.Buffer(make([]byte, 64*1024), 1024*1024)
				for sc.Scan() {
					if logFile != nil {
						fmt.Fprintf(logFile, "%s %s\n", time.Now().Format("15:04:05.000"), sc.Text())
					}
					select {
					case c.lines <- sc.Text():
					default: // nobody is waiting for old output
					}
				}
				close(c.lines)
			}()
			return c, nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return nil, fmt.Errorf("CS2's console never opened: %w", err)
		}
		time.Sleep(2 * time.Second)
	}
}

func (c *console) send(cmds ...string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, cmd := range cmds {
		if _, err := io.WriteString(c.conn, cmd+"\n"); err != nil {
			return err
		}
	}
	return nil
}

// drain forgets the output so far.
func (c *console) drain() {
	for {
		select {
		case <-c.lines:
		default:
			return
		}
	}
}

// expect waits for a line matching re and returns its first group.
func (c *console) expect(re *regexp.Regexp, wait time.Duration) (string, time.Time, error) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case line, ok := <-c.lines:
			if !ok {
				return "", time.Time{}, errors.New("CS2's console closed")
			}
			if m := re.FindStringSubmatch(line); m != nil {
				return m[1], time.Now(), nil
			}
		case <-timer.C:
			return "", time.Time{}, fmt.Errorf("CS2 never said %q", re.String())
		}
	}
}

// game is one CS2 in its own headless gamescope.
type game struct {
	cmd       *exec.Cmd
	con       *console
	node      string
	width     int
	height    int
	startTick int // the demo's first tick: the console's ticks count from it
	lastTick  int // the demo's length in ticks (the analyzer's last tick)
	logPath   string
}

// launchGame starts gamescope with CS2 and waits for its console and stream.
func (r *recorder) launchGame(ctx context.Context, logPath string) (*game, error) {
	// Another CS2 on the console port would answer in this one's place.
	if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", netconPort), time.Second); err == nil {
		conn.Close()
		return nil, fmt.Errorf("something already listens on port %d (another CS2?); stop it first", netconPort)
	}
	if err := awaitSteam(ctx, 3*time.Minute); err != nil {
		return nil, err
	}
	setRecordingVideo(r.width, r.height)
	w, h := strconv.Itoa(r.width), strconv.Itoa(r.height)
	args := []string{"--backend", "headless", "-W", w, "-H", h, "-w", w, "-h", h, "-r", "120", "--"}
	if r.sniper != "" {
		args = append(args, r.sniper, "--")
	}
	args = append(args, "./cs2.sh", "-steam", "-insecure", "-novid", "-console",
		"-width", w, "-height", h, "-fullscreen", "-netconport", strconv.Itoa(netconPort))
	cmd := exec.Command("gamescope", args...)
	cmd.Dir = r.gameDir
	cmd.Env = append(os.Environ(), "SteamAppId=730", "SteamGameId=730")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, err
	}
	pr, pw := io.Pipe()
	cmd.Stdout = io.MultiWriter(logFile, pw)
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start gamescope: %w", err)
	}
	g := &game{cmd: cmd, width: r.width, height: r.height, logPath: logPath}
	nodeCh := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			if m := reNode.FindStringSubmatch(sc.Text()); m != nil {
				select {
				case nodeCh <- m[1]:
				default:
				}
			}
		}
	}()
	go func() {
		_ = cmd.Wait()
		pw.Close()
		logFile.Close()
	}()
	select {
	case g.node = <-nodeCh:
	case <-time.After(90 * time.Second):
		g.stop()
		return nil, errors.New("gamescope never offered its video stream (see " + logPath + ")")
	}
	if g.con, err = dialConsole(ctx, 3*time.Minute, strings.TrimSuffix(logPath, filepath.Ext(logPath))+"-console.log"); err != nil {
		g.stop()
		return nil, err
	}
	// The main menu loads after the console opens.
	time.Sleep(10 * time.Second)
	return g, nil
}

func (g *game) stop() {
	if g.con != nil {
		_ = g.con.send("quit")
		time.Sleep(3 * time.Second)
		g.con.conn.Close()
	}
	// Steam's runtime starts CS2 in a session of its own, out of reach of
	// gamescope's process group: make sure it is gone.
	_ = exec.Command("pkill", "-KILL", "-f", "linuxsteamrt64/cs2 ").Run()
	if g.cmd.Process != nil {
		_ = syscall.Kill(-g.cmd.Process.Pid, syscall.SIGTERM)
		done := make(chan struct{})
		go func() { _ = g.cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			_ = syscall.Kill(-g.cmd.Process.Pid, syscall.SIGKILL)
		}
	}
}

// loadDemo applies the recorder's look, plays the demo (a path under
// game/csgo, no .dem), waits for its map to load and learns its first tick.
func (g *game) loadDemo(demo string, look []string) error {
	if err := g.con.send(look...); err != nil {
		return err
	}
	g.con.drain()
	if err := g.con.send("playdemo " + demo); err != nil {
		return err
	}
	// The map has loaded once the client switches to the game loop.
	if _, _, err := g.con.expect(reMapLoaded, 3*time.Minute); err != nil {
		return fmt.Errorf("the demo's map never loaded: %w", err)
	}
	time.Sleep(3 * time.Second)
	for i := 0; i < 10; i++ {
		g.con.drain()
		_ = g.con.send("demo_info")
		if v, _, err := g.con.expect(reStartTick, 3*time.Second); err == nil {
			g.startTick, _ = strconv.Atoi(v)
			if v, _, err := g.con.expect(reLastTick, 2*time.Second); err == nil {
				g.lastTick, _ = strconv.Atoi(v)
			}
			// The demo carries the server's host_timescale (4 when its match was
			// simulated); play it at its own speed.
			return g.con.send("demo_pause", "host_timescale 1")
		}
	}
	return errors.New("the demo never reported its first tick")
}

// spectate follows the player by their name in the demo.
func (g *game) spectate(name string) error {
	return g.con.send(fmt.Sprintf("spec_player \"%s\"", strings.ReplaceAll(name, `"`, "")))
}

// pause pauses the demo. CS2 says "paused on tick" when it pauses and
// nothing when it already was.
func (g *game) pause() error {
	g.con.drain()
	if err := g.con.send("demo_pause"); err != nil {
		return err
	}
	_, _, _ = g.con.expect(rePaused, 2*time.Second)
	return nil
}

// seekTimeout is how long a seek may take to land before the moment fails.
const seekTimeout = 45 * time.Second

// awaitSeek waits for a demo_gototick to land: a seek plays on by itself once
// it has, so pausing it answers with a tick near the target (analyzer ticks).
// While it still loads, CS2 does not answer at all.
func (g *game) awaitSeek(target int) error {
	// A seek back within the moment lands at once; one far into the demo is
	// polled until it has.
	time.Sleep(seekPoll)
	deadline := time.Now().Add(seekTimeout)
	for {
		g.con.drain()
		if err := g.con.send("demo_pause"); err != nil {
			return err
		}
		if v, _, err := g.con.expect(rePaused, 2*time.Second); err == nil {
			if tick, err := strconv.Atoi(v); err == nil && seekLanded(tick-g.startTick, target) {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the seek to tick %d did not land in %s", target, seekTimeout)
		}
		// Not there yet (or still paused where it was): let it go on.
		_ = g.con.send("demo_resume")
		time.Sleep(seekPoll)
	}
}

// resume plays the demo on and returns the tick it resumed at; if it was
// already playing (no answer), it pauses it and tries once more.
func (g *game) resume() (string, time.Time, error) {
	for i := 0; i < 2; i++ {
		g.con.drain()
		if err := g.con.send("demo_resume"); err != nil {
			return "", time.Time{}, err
		}
		if v, at, err := g.con.expect(reUnpaused, 3*time.Second); err == nil {
			return v, at, nil
		}
		if err := g.pause(); err != nil {
			return "", time.Time{}, err
		}
	}
	return "", time.Time{}, errors.New("the demo would not resume")
}

// play plays the demo from analyzer tick `from` to past `to` at `scale`
// (demo_timescale), calling started() just before it resumes. Ticks in the
// span are the analyzer's: CS2's console counts from the demo's first tick
// (g.startTick), its seek (demo_gototick) does not.
func (g *game) play(from, to int, scale float64, name string, started func() error) (span, error) {
	spans, err := g.playPhases(from, []playPhase{{to, scale}}, name, started)
	if len(spans) == 0 {
		return span{scale: scale}, err
	}
	return spans[0], err
}

// playPhases plays from `from` through each phase in turn without seeking
// again: between phases the demo pauses, changes speed and resumes, which
// costs a fraction of a second where a new pass costs a seek and a settle.
// Each phase is a span of its own (a steady rate between resume and pause).
func (g *game) playPhases(from int, phases []playPhase, name string, started func() error) ([]span, error) {
	if from < 0 {
		from = 0
	}
	// At its end the demo stops by itself and says nothing: stay clear of it.
	for i := range phases {
		if g.lastTick > 0 && phases[i].to > g.lastTick-endMargin {
			phases[i].to = g.lastTick - endMargin
		}
	}
	// A seek plays on by itself once it lands: seek, let it land, then pause.
	// Resumed straight after, so a demo the last pass left paused plays on
	// too and answers the first poll (paused, it said nothing and each seek
	// waited out a 2 s timeout).
	if err := g.con.send("host_timescale 1", "host_framerate 0", "fps_max 0",
		fmt.Sprintf("demo_timescale %g", phases[0].scale), fmt.Sprintf("demo_gototick %d", from), "demo_resume"); err != nil {
		return nil, err
	}
	// A seek far into the demo (round 19 straight after loading) takes CS2
	// longer than a few seconds: wait until it has landed near `from`.
	seekStart := time.Now()
	if err := g.awaitSeek(from); err != nil {
		return nil, err
	}
	seekTook := time.Since(seekStart)
	// A seek drops the spectated player, and CS2 ignores spec_player while the
	// seek still loads: ask once it has landed, again once paused, and again
	// just after resuming (the run-up before the moment covers the switch).
	if err := g.spectate(name); err != nil {
		return nil, err
	}
	time.Sleep(500 * time.Millisecond)
	if err := g.pause(); err != nil {
		return nil, err
	}
	if err := g.spectate(name); err != nil {
		return nil, err
	}
	// The capture starts (and links up) while the view settles.
	settle := time.Now()
	if err := started(); err != nil {
		return nil, err
	}
	time.Sleep(time.Duration(frameSettleMs)*time.Millisecond - time.Since(settle))
	var spans []span
	for i, ph := range phases {
		if i > 0 {
			if err := g.con.send(fmt.Sprintf("demo_timescale %g", ph.scale)); err != nil {
				return spans, err
			}
		}
		v, at, err := g.resume()
		if err != nil {
			return spans, err
		}
		if i == 0 {
			_ = g.spectate(name)
		}
		tick, _ := strconv.Atoi(v)
		s := span{scale: ph.scale, fromTick: tick - g.startTick, resumed: at}
		gameSeconds := float64(ph.to-s.fromTick) / tickrate
		wall := gameSeconds/ph.scale + 0.3
		if i < len(phases)-1 {
			// Pause on time rather than late: the next phase picks up wherever this one stops.
			wall = math.Max(0, gameSeconds/ph.scale)
		}
		log.Printf("playing ticks %d → %d at %gx (%.1f s; seek %.1f s, ready %.1f s)", s.fromTick, ph.to, ph.scale, wall,
			seekTook.Seconds(), time.Since(seekStart).Seconds())
		if gameSeconds > 60 || gameSeconds < -float64(tickrate) {
			return spans, fmt.Errorf("resumed at tick %d, too far from %d", s.fromTick, ph.to)
		}
		time.Sleep(time.Duration(wall * float64(time.Second)))
		g.con.drain()
		if err := g.con.send("demo_pause"); err != nil {
			return spans, err
		}
		v, at, err = g.con.expect(rePaused, 10*time.Second)
		if err != nil {
			return spans, fmt.Errorf("pausing after the moment: %w", err)
		}
		tick, _ = strconv.Atoi(v)
		s.toTick, s.paused = tick-g.startTick, at
		spans = append(spans, s)
	}
	return spans, nil
}

// videoCapture records the gamescope stream as raw I420 frames to a file,
// noting when each frame entered the pipeline (an `identity` prints a line per
// frame; the stream carries no usable timestamps). A paused demo is a still
// picture and gamescope sends few frames for it, so a frame's time is its own.
type videoCapture struct {
	cmd        *exec.Cmd
	path       string
	frameBytes int64
	mu         sync.Mutex
	times      []time.Time
	done       chan struct{}
}

func startVideoCapture(node, path string, width, height int) (*videoCapture, error) {
	client := fmt.Sprintf("atrec%d", os.Getpid())
	gst := []string{"-v", "-e", "pipewiresrc", "autoconnect=false", "client-name=" + client,
		"!", "identity", "name=tick", "silent=false",
		"!", "queue", "max-size-buffers=1200", "max-size-time=0", "max-size-bytes=0",
		"!", "videoconvert", "n-threads=8", "!", "video/x-raw,format=I420",
		"!", "filesink", "location=" + path}
	name, args := "gst-launch-1.0", gst
	if _, err := exec.LookPath("stdbuf"); err == nil {
		name, args = "stdbuf", append([]string{"-oL", "gst-launch-1.0"}, gst...)
	}
	cmd := exec.Command(name, args...)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	logFile, err := os.Create(path + ".log")
	if err != nil {
		return nil, err
	}
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start gst-launch-1.0: %w", err)
	}
	c := &videoCapture{cmd: cmd, path: path, frameBytes: int64(width * height * 3 / 2), done: make(chan struct{})}
	go func() {
		defer close(c.done)
		defer logFile.Close()
		sc := bufio.NewScanner(out)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if strings.Contains(line, "GstIdentity:tick: last-message = chain") {
				c.mu.Lock()
				c.times = append(c.times, time.Now())
				c.mu.Unlock()
			} else if !strings.Contains(line, "last-message") {
				fmt.Fprintln(logFile, line)
			}
		}
	}()
	if err := linkPorts("gamescope", client); err != nil {
		c.stop()
		return nil, err
	}
	time.Sleep(time.Second)
	return c, nil
}

func (c *videoCapture) stop() {
	if c.cmd.Process == nil {
		return
	}
	_ = c.cmd.Process.Signal(os.Interrupt)
	select {
	case <-c.done:
	case <-time.After(30 * time.Second):
		_ = c.cmd.Process.Kill()
	}
	_ = c.cmd.Wait()
}

// frameTimes is when each frame in the file arrived.
func (c *videoCapture) frameTimes() []time.Time {
	c.mu.Lock()
	times := append([]time.Time(nil), c.times...)
	c.mu.Unlock()
	if st, err := os.Stat(c.path); err == nil && c.frameBytes > 0 {
		if n := int(st.Size() / c.frameBytes); n < len(times) {
			times = times[:n]
		}
	}
	return times
}

// linkPorts connects the first output port of node `from` to the first input
// port of `to` (PipeWire's session manager won't link gamescope's stream).
func linkPorts(from, to string) error {
	var out, in string
	for i := 0; i < 20 && (out == "" || in == ""); i++ {
		time.Sleep(250 * time.Millisecond)
		out, in = firstPort("-o", from), firstPort("-i", to)
	}
	if out == "" || in == "" {
		return fmt.Errorf("no PipeWire ports to link %s → %s", from, to)
	}
	if b, err := exec.Command("pw-link", out, in).CombinedOutput(); err != nil {
		return fmt.Errorf("pw-link: %v %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}

func firstPort(dir, node string) string {
	b, err := exec.Command("pw-link", dir).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), node+":") {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

// audioCapture records what CS2 plays (the default sink's monitor) to a WAV.
type audioCapture struct {
	cmd     *exec.Cmd
	path    string
	started time.Time
	stopped time.Time
}

func startAudioCapture(target, path string) (*audioCapture, error) {
	cmd := exec.Command("pw-record", "-P", "{ stream.capture.sink=true }", "--target", target,
		"--rate", "48000", "--channels", "2", path)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pw-record: %w", err)
	}
	a := &audioCapture{cmd: cmd, path: path, started: time.Now()}
	// It records from when its stream links up; give it that moment.
	time.Sleep(500 * time.Millisecond)
	return a, nil
}

func (a *audioCapture) stop() {
	a.stopped = time.Now()
	_ = a.cmd.Process.Signal(os.Interrupt)
	_ = a.cmd.Wait()
}

// fileStart is when the file's first sample was recorded. pw-record records
// from when its stream links up, which takes a varying few hundred
// milliseconds after it starts, so the start is reckoned back from the stop:
// the file runs up to the moment it was stopped.
func (a *audioCapture) fileStart() time.Time {
	if d, err := wavSeconds(a.path); err == nil && d > 0 && !a.stopped.IsZero() {
		return a.stopped.Add(-time.Duration(d * float64(time.Second)))
	}
	return a.started
}

// defaultSink is the audio sink CS2 plays into (AT_AUDIO_TARGET overrides).
func defaultSink() string {
	if v := env("AT_AUDIO_TARGET", ""); v != "" {
		return v
	}
	if b, err := exec.Command("wpctl", "inspect", "@DEFAULT_AUDIO_SINK@").Output(); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if i := strings.Index(line, "node.name = "); i >= 0 {
				return strings.Trim(strings.TrimSpace(line[i+len("node.name = "):]), `"`)
			}
		}
	}
	return "auto_null"
}

// demoDir is where the recorder puts demos for CS2 (playdemo reads under game/csgo).
func demoDir(gameDir string) string { return filepath.Join(gameDir, "csgo", "at-recorder") }
