package main

// `at-worker record`: the highlight recorder. It asks the platform for the
// best moment not yet recorded (api/src/integrations/cs2/demos/highlights.ts),
// plays the demo in a CS2 client on this machine from the player's eyes,
// captures the frames, edits them (edit.go) and uploads the MP4.
//
// Linux and Windows alike: CS2 is started through Steam, driven over its
// console port (-netconport), and captured with its own `startmovie` frame
// dump, which renders every frame at host_framerate however long that takes.
//
// Environment, besides the worker's own:
//
//	AT_CS2_DIR       the CS2 install's game/csgo, writable: the demo goes there
//	AT_STEAM         the Steam executable (default: steam, or Steam.exe on Windows)
//	AT_RECORD_DIR    scratch space for the frames (default: the system temp dir)
//	AT_CAPTURE_FPS   frames per second of game time to capture (default 240)
//	AT_RESOLUTION    WIDTHxHEIGHT (default 2560x1440)
//	AT_ENCODER       ffmpeg video encoder (default libx264)

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const netconPort = 2121

type recordJob struct {
	ID         int    `json:"id"`
	MatchSlug  string `json:"matchSlug"`
	MapNumber  int    `json:"mapNumber"`
	MapName    string `json:"mapName"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
	Title      string `json:"title"`
	StartTick  int    `json:"startTick"`
	EndTick    int    `json:"endTick"`
	SlowmoTick int    `json:"slowmoTick"`
	KillTicks  []int  `json:"killTicks"`
}

type recorder struct {
	*client
	csgo       string
	steam      string
	scratch    string
	captureFPS int
	width      int
	height     int
	encoder    string
}

func (c *client) claimRecording(ctx context.Context) (*recordJob, error) {
	res, err := c.postJSON(ctx, "/api/game/cs2/recorder/claim", map[string]any{"recorder": c.worker})
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if err := ok(res, "claim"); err != nil {
		return nil, err
	}
	var body struct {
		Job *recordJob `json:"job"`
	}
	return body.Job, json.NewDecoder(res.Body).Decode(&body)
}

// accountID is the Steam account id a SteamID64 carries (what CS2's
// spec_player_by_accountid takes).
func accountID(steamID64 string) (uint64, error) {
	id, err := strconv.ParseUint(steamID64, 10, 64)
	if err != nil || id < 76561197960265728 {
		return 0, fmt.Errorf("not a SteamID64: %q", steamID64)
	}
	return id - 76561197960265728, nil
}

// netcon is CS2's console over TCP (-netconport): one command per line.
type netcon struct {
	conn net.Conn
	r    *bufio.Reader
}

func dialNetcon(ctx context.Context, wait time.Duration) (*netcon, error) {
	deadline := time.Now().Add(wait)
	for {
		var d net.Dialer
		conn, err := d.DialContext(ctx, "tcp", fmt.Sprintf("127.0.0.1:%d", netconPort))
		if err == nil {
			return &netcon{conn: conn, r: bufio.NewReader(conn)}, nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return nil, fmt.Errorf("CS2's console never opened: %w", err)
		}
		time.Sleep(2 * time.Second)
	}
}

func (n *netcon) send(cmd string) error {
	_, err := io.WriteString(n.conn, cmd+"\n")
	return err
}

// waitFor reads the console until a line contains `want`.
func (n *netcon) waitFor(want string, wait time.Duration) error {
	_ = n.conn.SetReadDeadline(time.Now().Add(wait))
	defer n.conn.SetReadDeadline(time.Time{})
	for {
		line, err := n.r.ReadString('\n')
		if strings.Contains(line, want) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("waiting for %q: %w", want, err)
		}
	}
}

func (r *recorder) download(ctx context.Context, j *recordJob, to string) error {
	res, err := r.do(ctx, http.MethodGet, "/api/demos/"+j.MatchSlug+"/download/"+strconv.Itoa(j.MapNumber), "", nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := ok(res, "download"); err != nil {
		return err
	}
	f, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, res.Body); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// launch starts CS2 through Steam with the console port open; it returns
// once the console answers.
func (r *recorder) launch(ctx context.Context) (*netcon, error) {
	args := []string{"-applaunch", "730", "-insecure", "-novid", "-console",
		"-fullscreen", "-width", strconv.Itoa(r.width), "-height", strconv.Itoa(r.height),
		"-netconport", strconv.Itoa(netconPort)}
	if err := exec.CommandContext(ctx, r.steam, args...).Start(); err != nil {
		return nil, fmt.Errorf("start CS2: %w", err)
	}
	return dialNetcon(ctx, 3*time.Minute)
}

// capture plays the moment and dumps its frames into dir; it returns the
// frame pattern for ffmpeg.
func (r *recorder) capture(ctx context.Context, con *netcon, j *recordJob, demo, dir string) (string, error) {
	acct, err := accountID(j.PlayerID)
	if err != nil {
		return "", err
	}
	// The demo path is relative to game/csgo, without .dem.
	if err := con.send("playdemo " + strings.TrimSuffix(demo, ".dem")); err != nil {
		return "", err
	}
	if err := con.waitFor("Demo playback", 2*time.Minute); err != nil {
		return "", err
	}
	// Two seconds early, so the view settles on the player before the clip.
	settle := 2 * tickrateTicks
	for _, cmd := range []string{
		"demo_pause",
		fmt.Sprintf("demo_gototick %d", max(0, j.StartTick-settle)),
		fmt.Sprintf("spec_player_by_accountid %d", acct),
		"cl_draw_only_deathnotices 1",
		"cl_drawhud_force_deathnotices 1",
		"volume 0",
		fmt.Sprintf("host_framerate %d", r.captureFPS),
	} {
		if err := con.send(cmd); err != nil {
			return "", err
		}
		time.Sleep(300 * time.Millisecond)
	}
	if err := con.send("demo_resume"); err != nil {
		return "", err
	}
	time.Sleep(time.Duration(settle) * time.Second / tickrateTicks)

	prefix := filepath.ToSlash(filepath.Join(dir, "f"))
	if err := con.send("startmovie " + prefix + " jpg"); err != nil {
		return "", err
	}
	// host_framerate makes game time independent of wall time: wait until
	// enough frames are on disk.
	want := (j.EndTick - j.StartTick) * r.captureFPS / tickrateTicks
	deadline := time.Now().Add(15 * time.Minute)
	for {
		frames, _ := filepath.Glob(filepath.Join(dir, "f*.jpg"))
		if len(frames) >= want {
			break
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			_ = con.send("endmovie")
			return "", fmt.Errorf("captured %d of %d frames", len(frames), want)
		}
		time.Sleep(time.Second)
	}
	_ = con.send("endmovie")
	_ = con.send("demo_pause")
	return filepath.Join(dir, "f%04d.jpg"), nil
}

func (r *recorder) record(ctx context.Context, j *recordJob) error {
	dir, err := os.MkdirTemp(r.scratch, fmt.Sprintf("highlight-%d-", j.ID))
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	demoRel := filepath.Join("at-recorder", fmt.Sprintf("%s-%d.dem", j.MatchSlug, j.MapNumber))
	demoAbs := filepath.Join(r.csgo, demoRel)
	if err := os.MkdirAll(filepath.Dir(demoAbs), 0o755); err != nil {
		return err
	}
	defer os.Remove(demoAbs)
	if err := r.download(ctx, j, demoAbs); err != nil {
		return err
	}

	con, err := r.launch(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = con.send("quit")
		con.conn.Close()
	}()
	frames, err := r.capture(ctx, con, j, filepath.ToSlash(demoRel), dir)
	if err != nil {
		return err
	}

	length := float64(j.EndTick-j.StartTick) / tickrateTicks
	kill := float64(j.SlowmoTick-j.StartTick) / tickrateTicks
	out := filepath.Join(dir, "clip.mp4")
	cmd := exec.CommandContext(ctx, "ffmpeg", editArgs(frames, r.captureFPS, speedRamp(length, kill), r.encoder, out)...)
	if b, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg: %v %s", err, strings.TrimSpace(string(b)))
	}

	f, err := os.Open(out)
	if err != nil {
		return err
	}
	defer f.Close()
	res, err := r.do(ctx, http.MethodPut, fmt.Sprintf("/api/game/cs2/recorder/jobs/%d/clip", j.ID), "video/mp4", f)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return ok(res, "upload")
}

func (r *recorder) failRecording(j *recordJob, cause error) {
	log.Printf("highlight %d (%s) failed: %v", j.ID, j.Title, cause)
	msg := cause.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	if res, err := r.postJSON(context.Background(), fmt.Sprintf("/api/game/cs2/recorder/jobs/%d/fail", j.ID), map[string]any{"error": msg}); err == nil {
		res.Body.Close()
	}
}

func defaultSteam() string {
	if runtime.GOOS == "windows" {
		return `C:\Program Files (x86)\Steam\steam.exe`
	}
	return "steam"
}

// runRecorder is the record loop: one moment at a time.
func runRecorder(ctx context.Context, c *client, poll time.Duration) error {
	csgo := env("AT_CS2_DIR", "")
	if csgo == "" {
		return errors.New("set AT_CS2_DIR to the CS2 install's game/csgo")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return errors.New("ffmpeg is not on PATH")
	}
	fps, _ := strconv.Atoi(env("AT_CAPTURE_FPS", "240"))
	var w, h int
	if _, err := fmt.Sscanf(env("AT_RESOLUTION", "2560x1440"), "%dx%d", &w, &h); err != nil {
		return fmt.Errorf("AT_RESOLUTION: %w", err)
	}
	r := &recorder{client: c, csgo: csgo, steam: env("AT_STEAM", defaultSteam()),
		scratch: env("AT_RECORD_DIR", os.TempDir()), captureFPS: max(60, fps),
		width: w, height: h, encoder: env("AT_ENCODER", "libx264")}
	log.Printf("recorder: %dx%d, %d fps captured, %s", w, h, r.captureFPS, r.encoder)

	for ctx.Err() == nil {
		j, err := c.claimRecording(ctx)
		if err != nil {
			log.Printf("cannot reach the platform: %v", err)
		}
		if j == nil {
			select {
			case <-ctx.Done():
			case <-time.After(poll):
			}
			continue
		}
		started := time.Now()
		if err := r.record(ctx, j); err != nil {
			r.failRecording(j, err)
			continue
		}
		log.Printf("highlight %d (%s) recorded in %s", j.ID, j.Title, time.Since(started).Round(time.Second))
	}
	return nil
}
