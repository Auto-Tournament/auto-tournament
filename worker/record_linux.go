//go:build linux

package main

// `at-worker record`: the highlight recorder. It asks the platform for a
// player's moments on one map (api/src/integrations/cs2/demos/highlights.ts),
// records each from the player's eyes in one CS2 session (capture.go), edits
// each with the slow motion on its last kill (edit.go), and uploads:
//
//   - each moment as its own clip (the profile's best play is the best one);
//   - the reel: the moments in match order, one after the other.
//
// `at-worker record-file <demo.dem> <player> <moments.json> <outdir>` does the
// same for a local demo, without the platform; <player> is a SteamID64 or
// `name:<in-demo name>` (bots have no SteamID).
//
// Linux only for now (gamescope). Environment, besides the worker's own:
//
//	AT_CS2_GAME      the CS2 install's `game` folder (has cs2.sh and csgo/)
//	AT_SNIPER_RUN    Steam's SteamLinuxRuntime_sniper/run, which cs2.sh needs
//	AT_RECORD_DIR    scratch space for raw frames (default: the system temp dir; ~6 GB a moment)
//	AT_RESOLUTION    WIDTHxHEIGHT (default 2560x1440)
//	AT_ENCODER       ffmpeg video encoder (default libx264)
//	AT_AUDIO_TARGET  the PipeWire sink CS2 plays into (default: the default sink)
//	AT_KEEP_SCRATCH  set to keep each moment's raw frames, sound and logs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
)

// moment is one highlight to record: its ticks are the demo's own.
type moment struct {
	ID         int    `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Round      int    `json:"round"`
	Score      int    `json:"score"`
	StartTick  int    `json:"startTick"`
	EndTick    int    `json:"endTick"`
	SlowmoTick int    `json:"slowmoTick"`
}

type recordJob struct {
	MatchSlug  string   `json:"matchSlug"`
	MapNumber  int      `json:"mapNumber"`
	MapName    string   `json:"mapName"`
	PlayerID   string   `json:"playerId"`
	PlayerName string   `json:"playerName"`
	Moments    []moment `json:"moments"`
}

type recorder struct {
	*client
	gameDir string
	sniper  string
	scratch string
	width   int
	height  int
	encoder string
	sink    string
}

func (c *client) claimRecording(ctx context.Context) (*recordJob, error) {
	res, err := c.postJSON(ctx, "/api/game/cs2/recorder/claim", map[string]any{"recorder": c.worker, "version": 2})
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

// demoName is the player's name in the demo (what spec_player takes).
func demoName(path, steamID string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	want, err := strconv.ParseUint(steamID, 10, 64)
	if err != nil {
		return "", fmt.Errorf("not a SteamID64: %q", steamID)
	}
	p := dem.NewParser(f)
	defer p.Close()
	for i := 0; i < 200000; i++ {
		more, err := p.ParseNextFrame()
		for _, pl := range p.GameState().Participants().All() {
			if pl != nil && pl.SteamID64 == want && pl.Name != "" {
				return pl.Name, nil
			}
		}
		if err != nil || !more {
			break
		}
	}
	return "", fmt.Errorf("%s is not in the demo", steamID)
}

// clipResult is one recorded moment, edited.
type clipResult struct {
	moment moment
	path   string
}

// recordMoments plays the demo once in CS2 and records each moment into
// outDir, returning the edited clips in match order.
func (r *recorder) recordMoments(ctx context.Context, demoPath, name string, moments []moment, outDir string) ([]clipResult, error) {
	if err := os.MkdirAll(demoDir(r.gameDir), 0o755); err != nil {
		return nil, err
	}
	base := fmt.Sprintf("rec-%d", os.Getpid())
	inGame := filepath.Join(demoDir(r.gameDir), base+".dem")
	if err := copyFile(demoPath, inGame); err != nil {
		return nil, err
	}
	defer os.Remove(inGame)

	g, err := r.launchGame(ctx, filepath.Join(outDir, "gamescope.log"))
	if err != nil {
		return nil, err
	}
	defer g.stop()
	if err := g.loadDemo("at-recorder/"+base, recorderLook); err != nil {
		return nil, err
	}

	sort.Slice(moments, func(i, j int) bool { return moments[i].StartTick < moments[j].StartTick })
	var clips []clipResult
	for _, m := range moments {
		if ctx.Err() != nil {
			return clips, ctx.Err()
		}
		started := time.Now()
		out := filepath.Join(outDir, fmt.Sprintf("moment-%d.mp4", m.ID))
		if err := r.recordMoment(g, name, m, out); err != nil {
			return clips, fmt.Errorf("%s: %w", m.Title, err)
		}
		log.Printf("recorded %q in %s", m.Title, time.Since(started).Round(time.Second))
		clips = append(clips, clipResult{moment: m, path: out})
	}
	return clips, nil
}

// lead is how much is played before a moment, for the view to settle.
const lead = tickrate

func (r *recorder) recordMoment(g *game, name string, m moment, out string) error {
	dir, err := os.MkdirTemp(r.scratch, "moment-")
	if err != nil {
		return err
	}
	if env("AT_KEEP_SCRATCH", "") == "" {
		defer os.RemoveAll(dir)
	}

	// The picture, at a quarter speed.
	raw := filepath.Join(dir, "video.yuv")
	var vc *videoCapture
	vs, err := g.play(m.StartTick-lead, m.EndTick, videoScale, name, func() (err error) {
		vc, err = startVideoCapture(g.node, raw, g.width, g.height)
		return err
	})
	if vc != nil {
		vc.stop()
	}
	if err != nil {
		return fmt.Errorf("video: %w", err)
	}
	win, err := windowFor(vc.frameTimes(), vs, m.StartTick, m.EndTick)
	if err != nil {
		return err
	}

	// The sound, at real speed.
	wav := filepath.Join(dir, "audio.wav")
	var ac *audioCapture
	as, err := g.play(m.StartTick-lead, m.EndTick, 1, name, func() (err error) {
		ac, err = startAudioCapture(r.sink, wav)
		return err
	})
	if ac != nil {
		ac.stop()
	}
	if err != nil {
		return fmt.Errorf("audio: %w", err)
	}
	audioAt := as.resumed.Sub(ac.started).Seconds() + float64(m.StartTick-as.fromTick)/tickrate

	length := float64(m.EndTick-m.StartTick) / tickrate
	kill := float64(m.SlowmoTick-m.StartTick) / tickrate
	args := momentArgs(raw, g.width, g.height, win, wav, audioAt, length, speedRamp(length, kill), m.Title, r.encoder, out)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg: %v %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}

// momentArgs are ffmpeg's arguments for one moment: the frames of its window
// at the rate they were captured, the sound from audioAt, the speed ramp and
// the caption.
func momentArgs(raw string, w, h int, win frameWindow, wav string, audioAt, length float64, segs []segment, caption, encoder, out string) []string {
	graph := fmt.Sprintf("[0:v]trim=start_frame=%d:end_frame=%d,setpts=PTS-STARTPTS[vin];[1:a]atrim=duration=%.4f,asetpts=PTS-STARTPTS[ain];",
		win.first, win.last+1, length)
	graph += strings.Replace(strings.Replace(momentFilter(segs, caption), "[0:v]split", "[vin]split", 1), "[1:a]asplit", "[ain]asplit", 1)
	args := []string{"-y", "-hide_banner", "-loglevel", "error",
		"-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", fmt.Sprintf("%dx%d", w, h), "-framerate", fmt.Sprintf("%.4f", win.rate), "-i", raw,
		"-ss", fmt.Sprintf("%.4f", maxf(0, audioAt)), "-i", wav,
		"-filter_complex", graph, "-map", "[v]", "-map", "[a]"}
	args = append(args, encodeArgs(encoder)...)
	return append(args, "-movflags", "+faststart", out)
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// joinReel puts the clips one after the other (same encoding, no re-encode).
func joinReel(clips []clipResult, out string) error {
	list := out + ".txt"
	var b strings.Builder
	for _, c := range clips {
		abs, _ := filepath.Abs(c.path)
		fmt.Fprintf(&b, "file '%s'\n", strings.ReplaceAll(abs, "'", `'\''`))
	}
	if err := os.WriteFile(list, []byte(b.String()), 0o644); err != nil {
		return err
	}
	defer os.Remove(list)
	cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out)
	if b, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg concat: %v %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func (r *recorder) download(ctx context.Context, j *recordJob, to string) error {
	res, err := r.do(ctx, http.MethodGet, "/api/demos/"+url.PathEscape(j.MatchSlug)+"/download/"+strconv.Itoa(j.MapNumber), "", nil)
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

func (r *recorder) upload(ctx context.Context, path, route string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	res, err := r.do(ctx, http.MethodPut, route, "video/mp4", f)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return ok(res, "upload "+filepath.Base(path))
}

func (r *recorder) record(ctx context.Context, j *recordJob) error {
	dir, err := os.MkdirTemp(r.scratch, "highlights-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	demoPath := filepath.Join(dir, "match.dem")
	if err := r.download(ctx, j, demoPath); err != nil {
		return err
	}
	name, err := demoName(demoPath, j.PlayerID)
	if err != nil {
		return err
	}
	clips, err := r.recordMoments(ctx, demoPath, name, j.Moments, dir)
	for _, c := range clips {
		if err := r.upload(ctx, c.path, fmt.Sprintf("/api/game/cs2/recorder/jobs/%d/clip", c.moment.ID)); err != nil {
			return err
		}
	}
	if err != nil {
		return err
	}
	if len(clips) > 1 {
		reel := filepath.Join(dir, "reel.mp4")
		if err := joinReel(clips, reel); err != nil {
			return err
		}
		return r.upload(ctx, reel, fmt.Sprintf("/api/game/cs2/recorder/reels/%s/%d/%s",
			url.PathEscape(j.MatchSlug), j.MapNumber, url.PathEscape(j.PlayerID)))
	}
	return nil
}

func (r *recorder) failRecording(j *recordJob, cause error) {
	log.Printf("highlights of %s on %s map %d failed: %v", j.PlayerName, j.MatchSlug, j.MapNumber, cause)
	msg := cause.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	ids := make([]int, 0, len(j.Moments))
	for _, m := range j.Moments {
		ids = append(ids, m.ID)
	}
	if res, err := r.postJSON(context.Background(), "/api/game/cs2/recorder/fail", map[string]any{"ids": ids, "error": msg}); err == nil {
		res.Body.Close()
	}
}

// newRecorder reads the recorder's settings from the environment.
func newRecorder(c *client) (*recorder, error) {
	gameDir := env("AT_CS2_GAME", "")
	if gameDir == "" {
		return nil, errors.New("set AT_CS2_GAME to the CS2 install's game folder (it has cs2.sh)")
	}
	for _, tool := range []string{"gamescope", "gst-launch-1.0", "pw-link", "pw-record", "ffmpeg"} {
		if _, err := exec.LookPath(tool); err != nil {
			return nil, fmt.Errorf("%s is not on PATH", tool)
		}
	}
	var w, h int
	if _, err := fmt.Sscanf(env("AT_RESOLUTION", "2560x1440"), "%dx%d", &w, &h); err != nil {
		return nil, fmt.Errorf("AT_RESOLUTION: %w", err)
	}
	return &recorder{client: c, gameDir: gameDir, sniper: env("AT_SNIPER_RUN", ""),
		scratch: env("AT_RECORD_DIR", os.TempDir()), width: w, height: h,
		encoder: env("AT_ENCODER", "libx264"), sink: defaultSink()}, nil
}

// runRecorder is the record loop: one player's moments on one map at a time.
func runRecorder(ctx context.Context, c *client, poll time.Duration) error {
	r, err := newRecorder(c)
	if err != nil {
		return err
	}
	log.Printf("recorder: %dx%d, %s, sound from %s", r.width, r.height, r.encoder, r.sink)
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
		log.Printf("highlights of %s on %s map %d: %d moment(s) in %s", j.PlayerName, j.MatchSlug, j.MapNumber, len(j.Moments), time.Since(started).Round(time.Second))
	}
	return nil
}

// recordFile is `at-worker record-file`: a local demo, no platform.
func recordFile(args []string) error {
	if len(args) < 4 {
		return errors.New("usage: at-worker record-file <demo.dem> <steamid64|name:NAME> <moments.json> <outdir>")
	}
	r, err := newRecorder(&client{})
	if err != nil {
		return err
	}
	name := strings.TrimPrefix(args[1], "name:")
	if !strings.HasPrefix(args[1], "name:") {
		if name, err = demoName(args[0], args[1]); err != nil {
			return err
		}
	}
	b, err := os.ReadFile(args[2])
	if err != nil {
		return err
	}
	var moments []moment
	if err := json.Unmarshal(b, &moments); err != nil {
		return fmt.Errorf("%s: %w", args[2], err)
	}
	if err := os.MkdirAll(args[3], 0o755); err != nil {
		return err
	}
	clips, err := r.recordMoments(context.Background(), args[0], name, moments, args[3])
	if err != nil {
		return err
	}
	if len(clips) > 1 {
		return joinReel(clips, filepath.Join(args[3], "reel.mp4"))
	}
	return nil
}
