//go:build linux

package main

// The CS2 side of the recorder: CS2 runs inside a headless gamescope and the
// recorder drives the demo over CS2's console port (-netconport). CS2 writes
// every frame and the sound itself through Frame by Frame
// (framebyframe_linux.go).
//
// Needs gamescope and Steam running with the bot account signed in (CS2 asks
// it for a ticket).

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

var errConsoleClosed = errors.New("CS2's console closed")

// expect waits for a line matching re and returns its first group.
func (c *console) expect(re *regexp.Regexp, wait time.Duration) (string, time.Time, error) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case line, ok := <-c.lines:
			if !ok {
				return "", time.Time{}, errConsoleClosed
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
	width     int
	height    int
	startTick int // the demo's first tick: the console's ticks count from it
	lastTick  int // the demo's length in ticks (the analyzer's last tick)
	logPath   string
	// gameinfo is the gameinfo.gi Frame by Frame patched, restored when CS2 stops.
	gameinfo string
	// fbfActionsOn: the plugin runs frame actions (its frame hook is on), asked once.
	fbfActionsOn, fbfActionsChecked bool
	// pausedAt is the analyzer tick the last seek landed and paused on.
	pausedAt int
	// follow, when set, is where the followed player stands at a tick (the
	// demo's replay frames): the capture checks the camera is with them.
	follow func(tick int) ([3]float64, bool)
}

// launchGame starts gamescope with CS2 and waits for its console.
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
	gameinfo, err := fbfInstall(r.gameDir)
	if err != nil {
		return nil, fmt.Errorf("frame by frame: %w", err)
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
	cmd.Stdout = logFile
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		logFile.Close()
		fbfRestore(gameinfo)
		return nil, fmt.Errorf("start gamescope: %w", err)
	}
	g := &game{cmd: cmd, width: r.width, height: r.height, logPath: logPath, gameinfo: gameinfo}
	go func() {
		_ = cmd.Wait()
		logFile.Close()
	}()
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
		// The console log is in the job's folder, which goes when the job ends.
		err = fmt.Errorf("the demo's map never loaded: %w", err)
		if tail := logTail(strings.TrimSuffix(g.logPath, filepath.Ext(g.logPath))+"-console.log", 40, 3000); tail != "" {
			err = fmt.Errorf("%w\n--- CS2 console, last lines ---\n%s", err, tail)
		}
		return err
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
		// Spectating plays the demo on, and the player runs on with it: compare
		// with where they are on the tick the demo stands on, not at `from`
		// (2026-10-24: the camera was on the player, 306 units from where they
		// had been, and every attempt failed).
		if t, ok := g.pausedTick(); ok {
			if at, ok := g.follow(t); ok {
				want = at
			}
		}
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

// pausedTick pauses the demo and returns the analyzer tick it stands on. A
// demo that is already paused answers nothing, so it then
// plays a frame and pauses again: trusting an older tick put every frame of
// a clip 48 ticks off (2026-10-24, "no frame near tick" on every attempt).
func (g *game) pausedTick() (int, bool) {
	for _, cmds := range [][]string{{"demo_pause"}, {"demo_resume", "demo_pause"}} {
		g.con.drain()
		if err := g.con.send(cmds...); err != nil {
			return 0, false
		}
		if v, _, err := g.con.expect(rePaused, time.Second); err == nil {
			if t, err := strconv.Atoi(v); err == nil {
				return t - g.startTick, true
			}
		}
	}
	return 0, false
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
