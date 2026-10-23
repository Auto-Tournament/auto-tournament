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
	// TrueView (the player's own view, rebuilt from their commands) even for a
	// demo from an older CS2 build: 1 turns it off then, and the first-person
	// view rebuilt from snapshots stutters back and forth (a jump in slow
	// motion, 2026-10-08).
	"cl_demo_predict 2",
	"r_show_build_info 0",
	"hud_showtargetid 0",
	"volume 1",
	// The sound's own settings, not the Steam profile's: a player's low
	// latency mix-ahead (the desktop's was 1 ms) runs dry while the PC
	// records, and the clip's sound breaks up; a demo needs no low latency.
	// Nothing muted when gamescope's window is not focused.
	"snd_mixahead 0.05",
	"snd_mute_losefocus 0",
	// Keep game effects, but remove the profile's music kit and event music.
	"snd_menumusic_volume 0",
	"snd_roundstart_volume 0",
	"snd_roundaction_volume 0",
	"snd_roundend_volume 0",
	"snd_mvp_volume 0",
	"snd_deathcamera_volume 0",
	"snd_mapobjective_volume 0",
	"snd_tensecondwarning_volume 0",
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
	reUnpaused = regexp.MustCompile(`unpaused on tick (\d+)`)
	rePaused   = regexp.MustCompile(`(?:^|[^n])paused on tick (\d+)`)
	// getpos: "setpos 1234.000000 -56.000000 89.031250;setang ...".
	reSetpos    = regexp.MustCompile(`setpos (-?[\d.]+ -?[\d.]+ -?[\d.]+)`)
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
	// fbf: Frame by Frame unhid startmovie (framebyframe_linux.go), known
	// once fbfChecked; gameinfo is the gameinfo.gi it patched, restored when
	// CS2 stops.
	fbf, fbfChecked bool
	gameinfo        string
	// pausedAt is the analyzer tick the last seek landed and paused on.
	pausedAt int
	// follow, when set, is where the followed player stands at a tick (the
	// demo's replay frames): the capture checks the camera is with them.
	follow func(tick int) ([3]float64, bool)
}

// launchGame starts gamescope with CS2 and waits for its console and stream.
func (r *recorder) launchGame(ctx context.Context, logPath string) (*game, error) {
	g, err := r.launchGameOnce(ctx, logPath)
	if err != nil {
		// The log is in the job's folder, which goes when the job ends: its
		// last lines go with the error (into the run report and the job log).
		if tail := logTail(logPath, 40, 3000); tail != "" {
			log.Printf("gamescope log, last lines:\n%s", tail)
			err = fmt.Errorf("%w\n--- gamescope log, last lines ---\n%s", err, tail)
		}
	}
	return g, err
}

func (r *recorder) launchGameOnce(ctx context.Context, logPath string) (*game, error) {
	// Another CS2 on the console port would answer in this one's place.
	if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", netconPort), time.Second); err == nil {
		conn.Close()
		return nil, fmt.Errorf("something already listens on port %d (another CS2?); stop it first", netconPort)
	}
	if err := awaitSteam(ctx, 3*time.Minute); err != nil {
		return nil, err
	}
	setRecordingVideo(r.width, r.height)
	gameinfo := ""
	if fbfWanted() {
		var err error
		if gameinfo, err = fbfInstall(r.gameDir); err != nil {
			log.Printf("frame by frame: not installed (%v); capturing the stream", err)
		}
	}
	w, h := strconv.Itoa(r.width), strconv.Itoa(r.height)
	args := []string{"--backend", "headless", "-W", w, "-H", h, "-w", w, "-h", h, "-r", strconv.Itoa(envPositive("AT_GAMESCOPE_HZ", 120)), "--"}
	if r.sniper != "" {
		args = append(args, r.sniper, "--")
	}
	args = append(args, "./cs2.sh", "-steam", "-insecure", "-novid", "-console",
		"-width", w, "-height", h, "-fullscreen", "-netconport", strconv.Itoa(netconPort))
	// AT_CS2_LAUNCH: more launch options (space-separated), for what CS2 won't
	// change during demo playback ("+fps_max 30": "Can't change 'fps_max' right now").
	args = append(args, strings.Fields(env("AT_CS2_LAUNCH", ""))...)
	cmd := exec.Command("gamescope", args...)
	cmd.Dir = r.gameDir
	cmd.Env = append(os.Environ(), "SteamAppId=730", "SteamGameId=730")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logFile, err := os.Create(logPath)
	if err != nil {
		fbfRestore(gameinfo)
		return nil, err
	}
	pr, pw := io.Pipe()
	cmd.Stdout = io.MultiWriter(logFile, pw)
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		logFile.Close()
		fbfRestore(gameinfo)
		return nil, fmt.Errorf("start gamescope: %w", err)
	}
	g := &game{cmd: cmd, width: r.width, height: r.height, logPath: logPath, gameinfo: gameinfo}
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
	case <-ctx.Done():
		g.stop()
		return nil, ctx.Err()
	case <-time.After(90 * time.Second):
		g.stop()
		return nil, errors.New("gamescope never offered its video stream")
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
	// gamescope's process group: make sure it is gone. Only this recorder's
	// CS2 (its console port): in a container with the host's PIDs (the
	// recorder command's --pid=host), the PC's own CS2 is in reach too.
	_ = exec.Command("pkill", "-KILL", "-f", fmt.Sprintf("linuxsteamrt64/cs2 .*-netconport %d", netconPort)).Run()
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
	fbfRestore(g.gameinfo)
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
			// sv_cheats for getpos (the follow check); a demo's own setting.
			return g.con.send("demo_pause", "host_timescale 1", "sv_cheats 1")
		}
	}
	return errors.New("the demo never reported its first tick")
}

// followAccounts maps a player's demo name to their Steam account id, so the
// camera can follow them by account: a name with characters the console
// mangles never matched, and the camera sat under the map for the whole clip
// (2026-10-12, every clip of one player).
var followAccounts sync.Map // name -> uint32 account id

// rememberAccount notes the account behind a demo name (steamID is a SteamID64).
func rememberAccount(name, steamID string) {
	if id, err := strconv.ParseUint(steamID, 10, 64); err == nil && id > 76561197960265728 {
		followAccounts.Store(name, uint32(id-76561197960265728))
	}
}

// spectate follows the player: by account id when it is known, and by their
// name in the demo as well (whichever the game takes).
func (g *game) spectate(name string) error {
	if v, ok := followAccounts.Load(name); ok {
		if err := g.con.send(fmt.Sprintf("spec_player_by_accountid %d", v.(uint32))); err != nil {
			return err
		}
	}
	return g.con.send(fmt.Sprintf("spec_player \"%s\"", strings.ReplaceAll(name, `"`, "")))
}

// followTolerance is how far (game units, about a player's height times 3)
// the camera may be from where the demo has the player.
const followTolerance = 250.0

// errNotFollowing: the camera would not follow the player.
var errNotFollowing = errors.New("could not follow the player: the camera stayed away from them")

// checkFollow asks for the camera's position and compares it with where the
// demo has the player around `from`; off, it follows again (up to three times)
// and then gives up, so the clip fails instead of shipping a view from under
// the map. Without a replay or an answer from getpos it cannot tell, and lets
// the capture go on.
func (g *game) checkFollow(name string, from int) error {
	if g.follow == nil {
		return nil
	}
	want, ok := g.follow(from)
	if !ok {
		return nil
	}
	for attempt := 0; attempt < 3; attempt++ {
		g.con.drain()
		if err := g.con.send("getpos"); err != nil {
			return err
		}
		v, _, err := g.con.expect(reSetpos, 2*time.Second)
		if err != nil {
			log.Printf("follow check: no getpos answer (%v); not checked", err)
			return nil
		}
		f := strings.Fields(v)
		x, _ := strconv.ParseFloat(f[0], 64)
		y, _ := strconv.ParseFloat(f[1], 64)
		z, _ := strconv.ParseFloat(f[2], 64)
		if x == 0 && y == 0 && z == 0 {
			// getpos reports the observer entity, not the player it watches, on
			// some CS2 builds (1.41.9: every in-eye view answered 0 0 0 and
			// failed every clip). Nobody stands at the map's exact origin: it is
			// "cannot tell", like no answer.
			log.Printf("follow check: getpos answered 0 0 0 (no position from this build); not checked")
			return nil
		}
		d := math.Sqrt((x-want[0])*(x-want[0]) + (y-want[1])*(y-want[1]) + (z-want[2])*(z-want[2]))
		if d <= followTolerance {
			if attempt > 0 {
				log.Printf("follow check: with %s after %d retries", name, attempt)
			}
			return nil
		}
		log.Printf("follow check: camera at (%.0f %.0f %.0f), %s at (%.0f %.0f %.0f), %.0f apart; following again",
			x, y, z, name, want[0], want[1], want[2], d)
		if err := g.spectate(name); err != nil {
			return err
		}
		time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
	}
	return errNotFollowing
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
func (g *game) awaitSeek(target int) (int, error) {
	// A seek back within the moment lands at once; one far into the demo is
	// polled until it has.
	time.Sleep(seekPoll)
	deadline := time.Now().Add(seekTimeout)
	for {
		g.con.drain()
		if err := g.con.send("demo_pause"); err != nil {
			return 0, err
		}
		if v, _, err := g.con.expect(rePaused, 2*time.Second); err == nil {
			if tick, err := strconv.Atoi(v); err == nil && seekLanded(tick-g.startTick, target) {
				g.pausedAt = tick - g.startTick
				return g.pausedAt, nil
			}
		}
		if time.Now().After(deadline) {
			return 0, fmt.Errorf("the seek to tick %d did not land in %s", target, seekTimeout)
		}
		// Not there yet (or still paused where it was): let it go on.
		_ = g.con.send("demo_resume")
		time.Sleep(seekPoll)
	}
}

// seekForCapture ensures the paused demo still has the clip's run-up ahead
// of it. CS2 can land several seconds after demo_gototick; awaitSeek's broad
// loading tolerance is not enough to guarantee the opening was captured.
func (g *game) seekForCapture(from int, scale float64) error {
	target := from
	for attempt := 0; attempt < 3; attempt++ {
		if err := g.con.send(fmt.Sprintf("demo_timescale %g", scale), fmt.Sprintf("demo_gototick %d", target), "demo_resume"); err != nil {
			return err
		}
		landed, err := g.awaitSeek(target)
		if err != nil {
			return err
		}
		if landed <= from+lead/2 {
			return nil
		}
		if target == 0 {
			return fmt.Errorf("seek resumed at tick %d, past capture run-up at %d", landed, from)
		}
		next := max(0, target-(landed-from)-lead)
		log.Printf("seek landed at tick %d past capture run-up %d; seeking back to %d", landed, from, next)
		target = next
	}
	return fmt.Errorf("seek could not preserve capture run-up at tick %d after 3 attempts", from)
}

// resume plays the demo on from analyzer tick `at` (where it is paused) and
// returns the tick it resumed at; if it said nothing, it pauses it, seeks
// back to `at` and tries once more. Its answer can go missing while the demo
// does play: the pause and second resume then started 120–200 ticks late,
// past the run-up, and the clip failed with "no frame near tick" on every
// retry (73 passes in 8 h on csm-test, 2026-10-20).
func (g *game) resume(at int, scale float64) (string, time.Time, error) {
	for i := 0; i < 2; i++ {
		g.con.drain()
		if err := g.con.send("demo_resume"); err != nil {
			return "", time.Time{}, err
		}
		if v, t, err := g.con.expect(reUnpaused, 3*time.Second); err == nil {
			return v, t, nil
		}
		if err := g.pause(); err != nil {
			return "", time.Time{}, err
		}
		if i == 0 {
			if err := g.seekForCapture(at, scale); err != nil {
				return "", time.Time{}, err
			}
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
	if err := g.con.send("host_timescale 1", "host_framerate 0", "fps_max 0"); err != nil {
		return nil, err
	}
	// A seek far into the demo (round 19 straight after loading) takes CS2
	// longer than a few seconds: wait until it has landed near `from`.
	seekStart := time.Now()
	if err := g.seekForCapture(from, phases[0].scale); err != nil {
		return nil, err
	}
	seekTook := time.Since(seekStart)
	// A seek drops the spectated player, and CS2 ignores spec_player while the
	// seek still loads: ask once it has landed, again a moment later, and again
	// just after resuming (the run-up before the moment covers the switch).
	if err := g.spectate(name); err != nil {
		return nil, err
	}
	time.Sleep(500 * time.Millisecond)
	// awaitSeek left it paused: pausing again got no answer and waited out
	// pause's 2 s timeout on every pass (AT_REPAUSE=1 for the old way).
	if env("AT_REPAUSE", "") == "1" {
		if err := g.pause(); err != nil {
			return nil, err
		}
	}
	if err := g.spectate(name); err != nil {
		return nil, err
	}
	// The camera must be with the player: a follow that never took left it
	// parked under the map for the whole clip, and the clip still shipped
	// (2026-10-12/13, clips 243, 244, 505).
	if err := g.checkFollow(name, from); err != nil {
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
		back := from
		if i > 0 {
			back = spans[i-1].toTick
		}
		v, at, err := g.resume(back, ph.scale)
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
		if gameSeconds > 60 || gameSeconds < -1 {
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
	// pts: each frame's presentation time in the stream (gstreamer's
	// buffer pts, seconds), or -1; far steadier than when its log line
	// reached us (frameTimes anchors them to the clock).
	pts  []float64
	done chan struct{}
}

func startVideoCapture(node, path string, width, height int) (*videoCapture, error) {
	client := fmt.Sprintf("atrec%d", os.Getpid())
	gst := []string{"-v", "-e", "pipewiresrc", "autoconnect=false", "client-name=" + client}
	// AT_STREAM_FORMAT asks gamescope for the stream in that format (NV12:
	// converted on the GPU, 1.5 bytes a pixel to copy out instead of 4).
	if f := env("AT_STREAM_FORMAT", ""); f != "" {
		gst = append(gst, "!", "video/x-raw,format="+f)
	}
	gst = append(gst,
		"!", "identity", "name=tick", "silent=false",
		"!", "queue", "max-size-buffers=1200", "max-size-time=0", "max-size-bytes=0",
		"!", "videoconvert", "n-threads=8", "!", "video/x-raw,format=I420",
		"!", "filesink", "location="+path)
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
				now := time.Now()
				c.mu.Lock()
				c.times = append(c.times, now)
				c.pts = append(c.pts, bufferPTS(line))
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
	times := ptsTimes(c.times, c.pts)
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

// killsPastEnd says whether any kill falls in the last endMargin of a demo
// lastTick long (0: length unknown), where playback cannot reach it.
func killsPastEnd(kills []int, lastTick int) bool {
	for _, k := range kills {
		if lastTick > 0 && k > lastTick-endMargin {
			return true
		}
	}
	return false
}
