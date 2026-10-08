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
//	AT_ENCODER       ffmpeg video encoder (default: h264_nvenc on the GPU if it opens, else libx264; H.264 in MP4)
//	AT_AUDIO_TARGET  the PipeWire sink CS2 plays into (default: the default sink)
//	AT_KEEP_SCRATCH  set to keep each moment's raw frames, sound and logs
//
// record-file only: AT_WATERMARK=0 leaves the logo out; AT_TEAMS ("A vs B"),
// AT_MAP and AT_TAG (the corner tag) go on the caption card; AT_AVATAR is an
// image file for the player's avatar.

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
	"syscall"
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
	KillTicks  []int  `json:"killTicks"`
}

type recordJob struct {
	MatchSlug  string `json:"matchSlug"`
	MapNumber  int    `json:"mapNumber"`
	MapName    string `json:"mapName"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
	// Match is the clip's match line: "Team A vs Team B · Tournament" (older platforms).
	Match string `json:"match"`
	// Teams ("Team A vs Team B"), the tournament and the stage ("Semi-final")
	// for the caption card and its corner tag.
	Teams      string `json:"teams"`
	Tournament string `json:"tournament"`
	Stage      string `json:"stage"`
	// AvatarURL is the player's avatar: absolute, or a path on the platform.
	AvatarURL string `json:"avatarUrl"`
	// Watermark: the Auto Tournament logo on each video (the platform's
	// setting; on when it says nothing).
	Watermark *bool    `json:"watermark"`
	Moments   []moment `json:"moments"`
	// Recorded clips of this player on this map from earlier jobs (a retry
	// records only what failed): the reel joins them in too.
	DoneClips []doneClip `json:"doneClips"`
}

// doneClip is a clip the platform already has.
type doneClip struct {
	ID        int    `json:"id"`
	StartTick int    `json:"startTick"`
	URL       string `json:"url"`
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
func (c *client) claimRecording(ctx context.Context) (*mapJob, *matchReelJob, error) {
	res, err := c.postJSON(ctx, "/api/game/cs2/recorder/claim", map[string]any{"recorder": c.worker, "version": 4})
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
	// A tournament reel is made the same way as a match reel: tag and join.
	if kind.Kind == "match_reel" || kind.Kind == "tournament_reel" {
		var j matchReelJob
		return nil, &j, json.Unmarshal(body.Job, &j)
	}
	if kind.Kind == "map" {
		var mj mapJob
		return &mj, nil, json.Unmarshal(body.Job, &mj)
	}
	var j recordJob
	if err := json.Unmarshal(body.Job, &j); err != nil {
		return nil, nil, err
	}
	return &mapJob{Kind: "map", MatchSlug: j.MatchSlug, MapNumber: j.MapNumber, Players: []recordJob{j}}, nil, nil
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
	moment  moment
	player  int // which of the job's players it is
	path    string
	markers clipMarkers
}

// shot is a moment to record, and whose eyes it is seen through.
type shot struct {
	m      moment
	player int
	name   string // the player's name in the demo (spec_player)
	look   clipLook
}

// mapJob is a whole map's waiting moments, every player's, for one CS2
// session (platforms from recorder version 4; an older platform's one-player
// job becomes a map job of one).
type mapJob struct {
	Kind      string      `json:"kind"`
	MatchSlug string      `json:"matchSlug"`
	MapNumber int         `json:"mapNumber"`
	Players   []recordJob `json:"players"`
}

func (mj *mapJob) moments() int {
	n := 0
	for _, p := range mj.Players {
		n += len(p.Moments)
	}
	return n
}

// clipLook is what goes on every clip of a job: the caption card's player,
// match and avatar, and whether the logo shows.
type clipLook struct {
	name      string
	teams     string
	mapName   string
	tag       string      // the corner tag: "NTLAN AUTUMN CUP · SEMI-FINAL"
	avatar    image.Image // round, or nil
	watermark bool
}

// momentFailure is a moment that could not be recorded, even after a retry.
type momentFailure struct {
	moment moment
	err    error
}

// recordMoments plays the demo in CS2 once and records each shot into outDir,
// through the eyes of the player it belongs to.
// A moment that fails is tried once more in a fresh CS2; if it fails again
// it is skipped and the others are still recorded. The error is only for
// what stops the whole job (the demo cannot be copied, CS2 never starts).
func (r *recorder) recordMoments(ctx context.Context, demoPath string, shots []shot, outDir string) ([]clipResult, []momentFailure, error) {
	if err := os.MkdirAll(demoDir(r.gameDir), 0o755); err != nil {
		return nil, nil, err
	}
	base := fmt.Sprintf("rec-%d", os.Getpid())
	inGame := filepath.Join(demoDir(r.gameDir), base+".dem")
	if err := copyFile(demoPath, inGame); err != nil {
		return nil, nil, err
	}
	defer os.Remove(inGame)

	var g *game
	start := func() error {
		if g != nil {
			g.stop()
			g = nil
		}
		next, err := r.launchGame(ctx, filepath.Join(outDir, "gamescope.log"))
		if err != nil {
			return err
		}
		g = next
		return g.loadDemo("at-recorder/"+base, recorderLook)
	}
	defer func() {
		if g != nil {
			g.stop()
		}
	}()
	if err := start(); err != nil {
		return nil, nil, err
	}

	// In demo order, whoever's they are: the seeks only go forward.
	sort.Slice(shots, func(i, j int) bool { return shots[i].m.StartTick < shots[j].m.StartTick })
	var clips []clipResult
	var failed []momentFailure
	for _, sh := range shots {
		m, name, look := sh.m, sh.name, sh.look
		if ctx.Err() != nil {
			return clips, failed, ctx.Err()
		}
		started := time.Now()
		out := filepath.Join(outDir, fmt.Sprintf("moment-%d.mp4", m.ID))
		var markers clipMarkers
		var err error
		for attempt := 1; attempt <= 2; attempt++ {
			if attempt > 1 {
				// CS2 can get stuck (a seek that never lands): start it afresh.
				log.Printf("retrying %q in a fresh CS2 after: %v", m.Title, err)
				if serr := start(); serr != nil {
					err = fmt.Errorf("%v; restarting CS2: %w", err, serr)
					break
				}
			}
			if markers, err = r.recordMoment(g, look, name, m, out); err == nil {
				break
			}
		}
		if err != nil {
			log.Printf("skipping %q: %v", m.Title, err)
			failed = append(failed, momentFailure{moment: m, err: err})
			continue
		}
		log.Printf("recorded %q in %s", m.Title, time.Since(started).Round(time.Second))
		clips = append(clips, clipResult{moment: m, player: sh.player, path: out, markers: markers})
	}
	return clips, failed, nil
}

// audioLatency is how much later CS2's sound lands in pw-record's file than
// the picture it belongs to: measured on the recorder VM (2026-10-07) as
// 0.12–0.17 s from AWP shots against their kills. AT_AUDIO_LATENCY_MS
// overrides it for another machine.
func audioLatency() float64 {
	if v, err := strconv.Atoi(env("AT_AUDIO_LATENCY_MS", "")); err == nil {
		return float64(v) / 1000
	}
	return 0.15
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

func (r *recorder) recordMoment(g *game, look clipLook, name string, m moment, out string) (clipMarkers, error) {
	dir, err := os.MkdirTemp(r.scratch, "moment-")
	if err != nil {
		return clipMarkers{}, err
	}
	if env("AT_KEEP_SCRATCH", "") == "" {
		defer os.RemoveAll(dir)
	}
	// The clip ends where the slow motion after the last kill does.
	end := m.SlowmoTick + int(math.Ceil(tailSec*tickrate))
	if g.lastTick > 0 && end > g.lastTick-endMargin {
		end = g.lastTick - endMargin
	}
	// Who, which match, map and round, and what the moment is; the clip
	// opens slowed down under it.
	card, err := captionCard{
		name: look.name, teams: look.teams, mapName: look.mapName, round: m.Round,
		kind: pillLabel(m.Kind, m.Title), tag: look.tag, avatar: look.avatar,
	}.layout(g.width, g.height)
	if err != nil {
		return clipMarkers{}, err
	}
	windows := planWindows(m.StartTick, end, m.SlowmoTick, m.KillTicks)
	var pieces []string
	var edits [][]segment
	for i, w := range windows {
		piece := filepath.Join(dir, fmt.Sprintf("piece-%d.mp4", i))
		// The first piece plays the card's entrance; the later ones (after a
		// jump cut) keep it small at the bottom.
		var pieceCard *cardRender
		if i == 0 {
			pieceCard = card
		} else if card != nil {
			pieceCard = card.Settled()
		}
		segs, err := r.recordWindow(g, look.watermark, pieceCard, name, w, filepath.Join(dir, fmt.Sprint(i)), piece)
		if err != nil {
			return clipMarkers{}, err
		}
		pieces = append(pieces, piece)
		edits = append(edits, segs)
	}
	kills := m.KillTicks
	if len(kills) == 0 {
		kills = []int{m.SlowmoTick}
	}
	markers := momentMarkers(windows, edits, kills)
	if len(pieces) == 1 {
		return markers, os.Rename(pieces[0], out)
	}
	// The jump cuts between a player's kills blend (reelCrossfade).
	fades := make([]join, len(pieces)-1)
	for i := range fades {
		fades[i] = joinFade
	}
	return markers, r.buildReel(pieces, fades, nil, out)
}

// recordWindow records one stretch of a moment into `out`: the picture slowed
// down (and again slower around the slow motion, for the last stretch), the
// sound at real speed, and the edit.
func (r *recorder) recordWindow(g *game, watermark bool, card *cardRender, name string, w window, prefix, out string) ([]segment, error) {
	main := prefix + "-main.yuv"
	mainTicks, err := r.capturePicture(g, name, w.from-lead, w.to, mainScale, main)
	if err != nil {
		return nil, fmt.Errorf("picture: %w", err)
	}
	sources := [][]float64{mainTicks}
	raws := []string{main}
	if card != nil && !card.settled {
		// The opening plays slowed down under the caption card: a frame for each of its frames.
		hold, up := introGame()
		introEnd := w.from + int(math.Ceil((hold+up)*tickrate)) + 4
		if introEnd > w.to {
			introEnd = w.to
		}
		intro := prefix + "-intro.yuv"
		introTicks, err := r.capturePicture(g, name, w.from-lead/2, introEnd, slowScale, intro)
		if err != nil {
			return nil, fmt.Errorf("slowed opening: %w", err)
		}
		sources, raws = append(sources, introTicks), append(raws, intro)
	}
	if w.slowmo >= 0 {
		slow := prefix + "-slow.yuv"
		slowTicks, err := r.capturePicture(g, name, w.slowmo-int(slowBeforeSec*tickrate)-lead/2, w.to, slowScale, slow)
		if err != nil {
			return nil, fmt.Errorf("slow motion: %w", err)
		}
		sources, raws = append(sources, slowTicks), append(raws, slow)
	}

	// The sound, at real speed.
	wav := prefix + "-audio.wav"
	var ac *audioCapture
	as, err := g.play(w.from-lead, w.to, 1, name, func() (err error) {
		ac, err = startAudioCapture(r.sink, wav)
		return err
	})
	if ac != nil {
		ac.stop()
	}
	if err != nil {
		return nil, fmt.Errorf("sound: %w", err)
	}
	// What CS2 plays reaches the recording audioLatency later: start that much
	// further in, or every shot is heard after the kill it made.
	audioAt := as.resumed.Sub(ac.started).Seconds() + float64(w.from-as.fromTick)/tickrate + audioLatency()

	length := float64(w.to-w.from) / tickrate
	kill := -1.0
	if w.slowmo >= 0 {
		kill = float64(w.slowmo-w.from) / tickrate
	}
	segs := editPlan(length, card != nil && !card.settled, kill)
	frames, err := timeline(sources, segs, w.from)
	if err != nil {
		return nil, err
	}
	return segs, r.encodeMoment(raws, frames, g.width, g.height, wav, audioAt, length, segs, watermark, card, out)
}

// encodeMoment streams the timeline's frames into ffmpeg at outputFPS with the
// sound, the slow motion on both, and the caption.
func (r *recorder) encodeMoment(raws []string, frames []frameRef, w, h int, wav string, audioAt, length float64,
	segs []segment, watermark bool, card *cardRender, out string) error {
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
	o := overlay{card: -1, logo: -1, width: w, height: h}
	next := 2
	// The card's frames come through a named pipe, drawn as ffmpeg asks for them.
	var cardPipe string
	if card != nil {
		cardPipe = out + ".card"
		_ = os.Remove(cardPipe)
		if err := syscall.Mkfifo(cardPipe, 0o600); err != nil {
			return fmt.Errorf("card pipe: %w", err)
		}
		defer os.Remove(cardPipe)
		args = append(args, "-f", "rawvideo", "-pix_fmt", "rgba", "-s", fmt.Sprintf("%dx%d", card.region.Dx(), card.region.Dy()),
			"-framerate", fmt.Sprint(cardFPS), "-i", cardPipe)
		o.card, o.cardAt, next = next, card.region.Min, next+1
	}
	if watermark {
		args = append(args, "-loop", "1", "-framerate", fmt.Sprint(outputFPS), "-i", r.logo)
		o.logo = next
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
	cardDone := make(chan error, 1)
	if card != nil {
		go func() {
			f, err := os.OpenFile(cardPipe, os.O_WRONLY, 0)
			if err != nil {
				cardDone <- err
				return
			}
			defer f.Close()
			for i := 0; i < card.Frames(); i++ {
				if _, err := f.Write(card.frameAt(float64(i) / cardFPS).Pix); err != nil {
					cardDone <- err
					return
				}
			}
			cardDone <- nil
		}()
	} else {
		cardDone <- nil
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
	waitErr := cmd.Wait()
	if card != nil {
		// ffmpeg gone before it opened the pipe: open its other end so the writer stops waiting.
		if f, err := os.OpenFile(cardPipe, os.O_RDONLY|syscall.O_NONBLOCK, 0); err == nil {
			f.Close()
		}
	}
	cardErr := <-cardDone
	if waitErr != nil {
		return fmt.Errorf("ffmpeg: %v %s", waitErr, strings.TrimSpace(stderr.String()))
	}
	if cardErr != nil {
		return fmt.Errorf("caption card: %w", cardErr)
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

// joinReel puts one player's clips one after the other, each blending into
// the next, after the reel's intro (nil: none).
func (r *recorder) joinReel(clips []clipResult, intro *reelIntro, out string) error {
	paths := make([]string, len(clips))
	joins := make([]join, 0, len(clips))
	for i, c := range clips {
		paths[i] = c.path
		if i > 0 {
			joins = append(joins, joinFade)
		}
	}
	return r.buildReel(paths, joins, intro, out)
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

func (r *recorder) download(ctx context.Context, matchSlug string, mapNumber int, to string) error {
	res, err := r.do(ctx, http.MethodGet, "/api/demos/"+url.PathEscape(matchSlug)+"/download/"+strconv.Itoa(mapNumber), "", nil)
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

// upload sends a video to the platform, with the headers that describe it
// (X-AT-Markers on a clip, X-AT-Clips on a reel).
func (r *recorder) upload(ctx context.Context, path, route string, headers map[string]string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	res, err := r.doWith(ctx, http.MethodPut, route, "video/mp4", f, headers)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return ok(res, "upload "+filepath.Base(path))
}

// lookFor is what one player's clips show: the caption card and the corner.
func (r *recorder) lookFor(ctx context.Context, j *recordJob) clipLook {
	look := clipLook{name: j.PlayerName, teams: j.Teams, mapName: mapDisplayName(j.MapName), tag: cornerTag(j.Tournament, j.Stage),
		watermark: j.Watermark == nil || *j.Watermark}
	if look.teams == "" {
		// An older platform: its match line is "teams · tournament".
		look.teams = strings.SplitN(j.Match, " · ", 2)[0]
	}
	if j.AvatarURL != "" {
		if img, err := r.fetchAvatar(ctx, j.AvatarURL); err != nil {
			log.Printf("no avatar for %s: %v", j.PlayerName, err)
		} else {
			look.avatar = img
		}
	}
	return look
}

// recordMap records a map's moments, every player's, in one CS2 session,
// then uploads each clip and each player's reel of the map.
func (r *recorder) recordMap(ctx context.Context, mj *mapJob) error {
	dir, err := os.MkdirTemp(r.scratch, "highlights-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	demoPath := filepath.Join(dir, "match.dem")
	if err := r.download(ctx, mj.MatchSlug, mj.MapNumber, demoPath); err != nil {
		return err
	}
	var shots []shot
	var failed []momentFailure
	for i := range mj.Players {
		p := &mj.Players[i]
		name, err := demoName(demoPath, p.PlayerID)
		if err != nil {
			// Not in this demo: their moments fail, the others go on.
			for _, m := range p.Moments {
				failed = append(failed, momentFailure{moment: m, err: err})
			}
			continue
		}
		look := r.lookFor(ctx, p)
		for _, m := range p.Moments {
			shots = append(shots, shot{m: m, player: i, name: name, look: look})
		}
	}
	clips, more, err := r.recordMoments(ctx, demoPath, shots, dir)
	failed = append(failed, more...)
	for _, c := range clips {
		markers, _ := json.Marshal(c.markers)
		if err := r.upload(ctx, c.path, fmt.Sprintf("/api/game/cs2/recorder/jobs/%d/clip", c.moment.ID),
			map[string]string{"X-AT-Markers": string(markers)}); err != nil {
			return err
		}
	}
	if err != nil {
		return err
	}
	for i := range mj.Players {
		var own []clipResult
		for _, c := range clips {
			if c.player == i {
				own = append(own, c)
			}
		}
		if err := r.uploadReel(ctx, dir, &mj.Players[i], own); err != nil {
			return err
		}
	}
	// The moments that failed twice go back to the platform, which tries them
	// again later (a few times) and then gives up on them.
	if len(failed) > 0 {
		r.failMoments(failed)
	}
	return nil
}

// uploadReel joins one player's plays on the map (and what earlier jobs
// recorded of them, on a retry) into their reel of the map.
func (r *recorder) uploadReel(ctx context.Context, dir string, j *recordJob, clips []clipResult) error {
	// Without the funny ones: those are for the tournament reel.
	var plays []clipResult
	for _, c := range clips {
		if c.moment.Kind != "funny" {
			plays = append(plays, c)
		}
	}
	if len(plays) == 0 {
		return nil
	}
	for _, d := range j.DoneClips {
		path := filepath.Join(dir, fmt.Sprintf("done-%d.mp4", d.ID))
		if err := r.downloadTo(ctx, d.URL, path); err != nil {
			log.Printf("reel without clip %d: %v", d.ID, err)
			continue
		}
		plays = append(plays, clipResult{moment: moment{ID: d.ID, StartTick: d.StartTick}, path: path})
	}
	if len(plays) < 2 {
		return nil
	}
	sort.Slice(plays, func(a, b int) bool { return plays[a].moment.StartTick < plays[b].moment.StartTick })
	reel := filepath.Join(dir, fmt.Sprintf("reel-%s.mp4", j.PlayerID))
	if err := r.joinReel(plays, playerReelIntro(j, len(plays)), reel); err != nil {
		return err
	}
	ids := make([]string, len(plays))
	for i, c := range plays {
		ids[i] = strconv.Itoa(c.moment.ID)
	}
	return r.upload(ctx, reel, fmt.Sprintf("/api/game/cs2/recorder/reels/%s/%d/%s",
		url.PathEscape(j.MatchSlug), j.MapNumber, url.PathEscape(j.PlayerID)),
		map[string]string{"X-AT-Clips": strings.Join(ids, ",")})
}

// failMoments tells the platform these moments could not be recorded.
func (r *recorder) failMoments(failed []momentFailure) {
	ids := make([]int, len(failed))
	msgs := make([]string, len(failed))
	for i, f := range failed {
		ids[i] = f.moment.ID
		msgs[i] = f.moment.Title + ": " + f.err.Error()
	}
	msg := strings.Join(msgs, "; ")
	if len(msg) > 500 {
		msg = msg[:500]
	}
	if res, err := r.postJSON(context.Background(), "/api/game/cs2/recorder/fail", map[string]any{"ids": ids, "error": msg}); err == nil {
		res.Body.Close()
	}
}

func (r *recorder) failRecording(mj *mapJob, cause error) {
	log.Printf("highlights of %s map %d failed: %v", mj.MatchSlug, mj.MapNumber, cause)
	msg := cause.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	ids := make([]int, 0, mj.moments())
	for _, p := range mj.Players {
		for _, m := range p.Moments {
			ids = append(ids, m.ID)
		}
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
		encoder: env("AT_ENCODER", pickEncoder()), sink: defaultSink()}
	r.logo = filepath.Join(r.scratch, "at-watermark.png")
	if err := os.WriteFile(r.logo, watermarkPNG, 0o644); err != nil {
		return nil, err
	}
	return r, nil
}

// runRecorder is the record loop: one map's moments at a time, all players.
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
			log.Printf("%s: %d clip(s) in %s", reel.label(), len(reel.Clips), time.Since(started).Round(time.Second))
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
		if err := r.recordMap(ctx, j); err != nil {
			r.failRecording(j, err)
			continue
		}
		log.Printf("highlights of %s map %d: %d moment(s) of %d player(s) in %s", j.MatchSlug, j.MapNumber, j.moments(), len(j.Players), time.Since(started).Round(time.Second))
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
	look := clipLook{name: name, teams: env("AT_TEAMS", ""), mapName: env("AT_MAP", ""), tag: env("AT_TAG", ""),
		watermark: env("AT_WATERMARK", "1") != "0"}
	if file := env("AT_AVATAR", ""); file != "" {
		src, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		if look.avatar, err = roundAvatarImage(src); err != nil {
			return err
		}
	}
	shots := make([]shot, len(moments))
	for i, m := range moments {
		shots[i] = shot{m: m, name: name, look: look}
	}
	clips, failed, err := r.recordMoments(context.Background(), args[0], shots, args[3])
	if err != nil {
		return err
	}
	for _, f := range failed {
		log.Printf("could not record %q: %v", f.moment.Title, f.err)
	}
	for _, c := range clips {
		b, _ := json.MarshalIndent(c.markers, "", "  ")
		if err := os.WriteFile(strings.TrimSuffix(c.path, ".mp4")+".json", b, 0o644); err != nil {
			return err
		}
	}
	if len(clips) > 1 {
		return r.joinReel(clips, cliIntro("Player reel", name), filepath.Join(args[3], "reel.mp4"))
	}
	return nil
}

// pickEncoder is the GPU's H.264 encoder when it opens (a second of test
// video), else x264 on the CPU: same codec and container either way.
func pickEncoder() string {
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30", "-t", "1",
		"-c:v", "h264_nvenc", "-f", "null", "-")
	if out, err := cmd.CombinedOutput(); err != nil {
		reason := strings.TrimSpace(string(out))
		if i := strings.IndexByte(reason, '\n'); i > 0 {
			reason = reason[:i]
		}
		log.Printf("NVENC is not available (%s): encoding H.264 on the CPU", reason)
		return "libx264"
	}
	return "h264_nvenc"
}

// joinReelFiles is `at-worker join-reel <out.mp4> <clip.mp4>...`: local clips
// joined into a reel the way the platform's match reels are: each clip is
// another player (the orange wipe between them), after an intro from
// AT_INTRO_KICKER / AT_INTRO_TITLE / AT_INTRO_META / AT_INTRO_DATE (or AT_TEAMS,
// AT_TAG and AT_MAP; AT_INTRO=0 for none).
func joinReelFiles(out string, clips []string) error {
	r := &recorder{encoder: env("AT_ENCODER", pickEncoder())}
	joins := make([]join, 0, len(clips))
	for i := 1; i < len(clips); i++ {
		joins = append(joins, joinWipe)
	}
	return r.buildReel(clips, joins, cliIntro("Match highlights", env("AT_TEAMS", "")), out)
}

// cliIntro is the intro the local commands give a reel, from the environment.
func cliIntro(kicker, title string) *reelIntro {
	if env("AT_INTRO", "1") == "0" {
		return nil
	}
	in := &reelIntro{
		Kicker: env("AT_INTRO_KICKER", kicker),
		Title:  env("AT_INTRO_TITLE", title),
		Meta:   env("AT_INTRO_META", titleCase(env("AT_TAG", ""))),
		Map:    env("AT_MAP", ""),
		Date:   time.Now().Format("2 January 2006"),
	}
	// AT_INTRO_DATE set but blank: no date (an old demo's day is not today).
	if d, ok := os.LookupEnv("AT_INTRO_DATE"); ok {
		in.Date = strings.TrimSpace(d)
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil
	}
	return in
}

// playerReelIntro is the intro of one player's reel of a map.
func playerReelIntro(j *recordJob, clips int) *reelIntro {
	if j.PlayerName == "" {
		return nil
	}
	meta := fmt.Sprintf("%d highlights", clips)
	if j.Teams != "" {
		meta = joinDot(meta, j.Teams)
	}
	return &reelIntro{
		Kicker: "Player reel",
		Title:  j.PlayerName,
		Meta:   joinDot(meta, j.Tournament),
		Map:    j.MapName,
		Date:   time.Now().Format("2 January 2006"),
	}
}
