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
//
// record-file only: AT_WATERMARK=0 leaves the logo out; AT_MATCH_LINE is the
// caption's match line; AT_AVATAR an image file for the player's avatar.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"log"
	"math"
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
	MatchSlug  string `json:"matchSlug"`
	MapNumber  int    `json:"mapNumber"`
	MapName    string `json:"mapName"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
	// Match is the clip's match line: "Team A vs Team B · Tournament".
	Match string `json:"match"`
	// AvatarURL is the player's avatar: absolute, or a path on the platform.
	AvatarURL string `json:"avatarUrl"`
	// Watermark: the Auto Tournament logo on each video (the platform's
	// setting; on when it says nothing).
	Watermark *bool    `json:"watermark"`
	Moments   []moment `json:"moments"`
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
	logo    string // the watermark PNG on disk
}

// claimRecording asks the platform for work: a player's moments to record
// (recordJob), or a map's match reel to join (matchReelJob); nil, nil when
// there is none.
func (c *client) claimRecording(ctx context.Context) (*recordJob, *matchReelJob, error) {
	res, err := c.postJSON(ctx, "/api/game/cs2/recorder/claim", map[string]any{"recorder": c.worker, "version": 2})
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNoContent {
		return nil, nil, nil
	}
	if err := ok(res, "claim"); err != nil {
		return nil, nil, err
	}
	var body struct {
		Job json.RawMessage `json:"job"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, nil, err
	}
	var kind struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(body.Job, &kind); err != nil {
		return nil, nil, err
	}
	if kind.Kind == "match_reel" {
		var j matchReelJob
		return nil, &j, json.Unmarshal(body.Job, &j)
	}
	var j recordJob
	return &j, nil, json.Unmarshal(body.Job, &j)
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

// clipLook is what goes on every clip of a job: the caption card's player,
// match and avatar, and whether the logo shows.
type clipLook struct {
	name      string
	match     string
	avatar    image.Image // round, or nil
	watermark bool
}

// recordMoments plays the demo once in CS2 and records each moment into outDir.
func (r *recorder) recordMoments(ctx context.Context, demoPath, name string, look clipLook, moments []moment, outDir string) ([]clipResult, error) {
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
		if err := r.recordMoment(g, look, name, m, out); err != nil {
			return clips, fmt.Errorf("%s: %w", m.Title, err)
		}
		log.Printf("recorded %q in %s", m.Title, time.Since(started).Round(time.Second))
		clips = append(clips, clipResult{moment: m, path: out})
	}
	return clips, nil
}

// lead is how much is played before a moment, for the view to settle.
const lead = tickrate

// How the picture is slowed while it is captured: the whole moment at
// mainScale (~130 frames per game second), and from the last kill on, where
// the clip slows down, again at slowScale (~260) so the slow motion has a real
// frame for every frame it shows.
const (
	mainScale     = 0.2
	slowScale     = 0.1
	slowBeforeSec = 0.25
)

// capturePicture plays ticks [from, to] at scale and returns each captured
// frame's tick and the raw file holding them.
func (r *recorder) capturePicture(g *game, name string, from, to int, scale float64, raw string) ([]float64, error) {
	var vc *videoCapture
	s, err := g.play(from, to, scale, name, func() (err error) {
		vc, err = startVideoCapture(g.node, raw, g.width, g.height)
		return err
	})
	if vc != nil {
		vc.stop()
	}
	if err != nil {
		return nil, err
	}
	return frameTicks(vc.frameTimes(), s), nil
}

func (r *recorder) recordMoment(g *game, look clipLook, name string, m moment, out string) error {
	dir, err := os.MkdirTemp(r.scratch, "moment-")
	if err != nil {
		return err
	}
	if env("AT_KEEP_SCRATCH", "") == "" {
		defer os.RemoveAll(dir)
	}

	// The clip ends where the slow motion after the last kill does.
	end := m.SlowmoTick + int(math.Ceil(tailSec*tickrate))
	if g.lastTick > 0 && end > g.lastTick-endMargin {
		end = g.lastTick - endMargin
	}
	main := filepath.Join(dir, "main.yuv")
	mainTicks, err := r.capturePicture(g, name, m.StartTick-lead, end, mainScale, main)
	if err != nil {
		return fmt.Errorf("picture: %w", err)
	}
	slow := filepath.Join(dir, "slow.yuv")
	slowTicks, err := r.capturePicture(g, name, m.SlowmoTick-int(slowBeforeSec*tickrate)-lead/2, end, slowScale, slow)
	if err != nil {
		return fmt.Errorf("slow motion: %w", err)
	}

	// The sound, at real speed.
	wav := filepath.Join(dir, "audio.wav")
	var ac *audioCapture
	as, err := g.play(m.StartTick-lead, end, 1, name, func() (err error) {
		ac, err = startAudioCapture(r.sink, wav)
		return err
	})
	if ac != nil {
		ac.stop()
	}
	if err != nil {
		return fmt.Errorf("sound: %w", err)
	}
	audioAt := as.resumed.Sub(ac.started).Seconds() + float64(m.StartTick-as.fromTick)/tickrate

	length := float64(end-m.StartTick) / tickrate
	segs := speedRamp(length, float64(m.SlowmoTick-m.StartTick)/tickrate)
	frames, err := timeline([][]float64{mainTicks, slowTicks}, segs, m.StartTick)
	if err != nil {
		return err
	}
	// Kept short enough to read in its few seconds: who, and which match.
	card, err := captionCard{name: look.name, moment: look.match, avatar: look.avatar}.render(g.height)
	if err != nil {
		return err
	}
	cardPath := filepath.Join(dir, "card.png")
	if err := os.WriteFile(cardPath, card, 0o644); err != nil {
		return err
	}
	return r.encodeMoment([]string{main, slow}, frames, g.width, g.height, wav, audioAt, length, segs, look.watermark, cardPath, out)
}

// encodeMoment streams the timeline's frames into ffmpeg at outputFPS with the
// sound, the slow motion on both, and the caption.
func (r *recorder) encodeMoment(raws []string, frames []frameRef, w, h int, wav string, audioAt, length float64,
	segs []segment, watermark bool, card, out string) error {
	files := make([]*os.File, len(raws))
	for i, p := range raws {
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		files[i] = f
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error",
		"-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", fmt.Sprintf("%dx%d", w, h), "-framerate", fmt.Sprint(outputFPS), "-i", "pipe:0",
		"-ss", fmt.Sprintf("%.4f", maxf(0, audioAt)), "-i", wav}
	o := overlay{card: 2, logo: -1, width: w, height: h}
	args = append(args, "-loop", "1", "-framerate", fmt.Sprint(outputFPS), "-t", fmt.Sprintf("%g", captionSec+0.5), "-i", card)
	if watermark {
		args = append(args, "-loop", "1", "-framerate", fmt.Sprint(outputFPS), "-i", r.logo)
		o.logo = 3
	}
	args = append(args, "-filter_complex", videoFilter(o)+";"+audioFilter(segs, length), "-map", "[v]", "-map", "[a]")
	args = append(args, encodeArgs(r.encoder)...)
	args = append(args, "-movflags", "+faststart", out)
	cmd := exec.Command("ffmpeg", args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	frameBytes := int64(w * h * 3 / 2)
	buf := make([]byte, frameBytes)
	var werr error
	for _, f := range frames {
		if _, werr = files[f.source].ReadAt(buf, int64(f.index)*frameBytes); werr != nil {
			break
		}
		if _, werr = stdin.Write(buf); werr != nil {
			break
		}
	}
	stdin.Close()
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg: %v %s", err, strings.TrimSpace(stderr.String()))
	}
	if werr != nil {
		return fmt.Errorf("feeding ffmpeg: %w", werr)
	}
	return nil
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// joinReel puts the clips one after the other (same encoding, no re-encode).
func joinReel(clips []clipResult, out string) error {
	paths := make([]string, len(clips))
	for i, c := range clips {
		paths[i] = c.path
	}
	return concatFiles(paths, out)
}

// concatFiles joins MP4s of the same encoding without re-encoding.
func concatFiles(paths []string, out string) error {
	list := out + ".txt"
	var b strings.Builder
	for _, p := range paths {
		abs, _ := filepath.Abs(p)
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

// fetchAvatar downloads the player's avatar (a platform path is fetched from
// the platform) and cuts it round.
func (r *recorder) fetchAvatar(ctx context.Context, avatarURL string) (image.Image, error) {
	var res *http.Response
	var err error
	if strings.HasPrefix(avatarURL, "/") {
		res, err = r.do(ctx, http.MethodGet, avatarURL, "", nil)
	} else {
		req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, avatarURL, nil)
		if rerr != nil {
			return nil, rerr
		}
		res, err = r.http.Do(req)
	}
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if err := ok(res, "avatar"); err != nil {
		return nil, err
	}
	src, err := io.ReadAll(io.LimitReader(res.Body, 10<<20))
	if err != nil {
		return nil, err
	}
	return roundAvatarImage(src)
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
	look := clipLook{name: j.PlayerName, match: j.Match, watermark: j.Watermark == nil || *j.Watermark}
	if j.AvatarURL != "" {
		if img, err := r.fetchAvatar(ctx, j.AvatarURL); err != nil {
			log.Printf("no avatar for %s: %v", j.PlayerName, err)
		} else {
			look.avatar = img
		}
	}
	clips, err := r.recordMoments(ctx, demoPath, name, look, j.Moments, dir)
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
	r := &recorder{client: c, gameDir: gameDir, sniper: env("AT_SNIPER_RUN", ""),
		scratch: env("AT_RECORD_DIR", os.TempDir()), width: w, height: h,
		encoder: env("AT_ENCODER", "libx264"), sink: defaultSink()}
	r.logo = filepath.Join(r.scratch, "at-watermark.png")
	if err := os.WriteFile(r.logo, watermarkPNG, 0o644); err != nil {
		return nil, err
	}
	return r, nil
}

// runRecorder is the record loop: one player's moments on one map at a time.
func runRecorder(ctx context.Context, c *client, poll time.Duration) error {
	r, err := newRecorder(c)
	if err != nil {
		return err
	}
	log.Printf("recorder: %dx%d, %s, sound from %s", r.width, r.height, r.encoder, r.sink)
	for ctx.Err() == nil {
		j, reel, err := c.claimRecording(ctx)
		if err != nil {
			log.Printf("cannot reach the platform: %v", err)
		}
		if reel != nil {
			started := time.Now()
			if err := r.makeMatchReel(ctx, reel); err != nil {
				r.failMatchReel(reel, err)
				continue
			}
			log.Printf("match reel of %s map %d: %d clip(s) in %s", reel.MatchSlug, reel.MapNumber, len(reel.Clips), time.Since(started).Round(time.Second))
			continue
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
	look := clipLook{name: name, match: env("AT_MATCH_LINE", ""), watermark: env("AT_WATERMARK", "1") != "0"}
	if file := env("AT_AVATAR", ""); file != "" {
		src, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		if look.avatar, err = roundAvatarImage(src); err != nil {
			return err
		}
	}
	clips, err := r.recordMoments(context.Background(), args[0], name, look, moments, args[3])
	if err != nil {
		return err
	}
	if len(clips) > 1 {
		return joinReel(clips, filepath.Join(args[3], "reel.mp4"))
	}
	return nil
}
