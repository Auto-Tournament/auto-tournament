//go:build linux

package main

// Native capture uses CS:DM's MIT-licensed CS2 plugin. The plugin executes
// commands on demo ticks; startmovie advances game time per rendered frame,
// independently of how long that frame takes on the host.
import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

//go:embed assets/native/libserver.so
var nativePlugin []byte

type nativeAction struct {
	Tick int    `json:"tick"`
	Cmd  string `json:"cmd"`
}

type nativeSequence struct {
	Actions []nativeAction `json:"actions"`
}

// nativeActions deliberately records a run-up and a small tail. The editor
// trims those using the frame clock, including fractional ticks above 64 fps.
func nativeActions(from, to, fps int, prefix, player string, look []string) []nativeSequence {
	setup := max(2, from-tickrate)
	var actions []nativeAction
	add := func(tick int, cmd string) { actions = append(actions, nativeAction{tick, cmd}) }
	for _, cmd := range look {
		add(1, cmd)
	}
	add(1, "host_timescale 1")
	add(1, "demo_timescale 1")
	add(1, "host_framerate 0")
	add(1, fmt.Sprintf("demo_gototick %d", setup-1))
	add(setup, "sv_cheats 1")
	add(setup, "spec_mode 1")
	// Never interpolate a name into a multi-command console string.
	account, hasAccount := followAccounts.Load(player)
	player = strings.NewReplacer("\"", "", ";", "", "\n", "", "\r", "").Replace(player)
	add(setup, fmt.Sprintf("spec_player \"%s\"", player))
	if hasAccount {
		add(setup, fmt.Sprintf("spec_player_by_accountid %d", account.(uint32)))
	}
	add(setup, fmt.Sprintf("host_framerate %d", fps))
	add(max(setup+1, from-4), "pause_playback")
	add(from, "startmovie "+prefix)
	add(to, "endmovie")
	add(to, "echo AT_NATIVE_DONE_"+prefix)
	add(to, "demo_pause")
	return []nativeSequence{{Actions: actions}}
}

// The existing editor accepts a fixed-size I420 file and a tick per frame.
// Only these two things and the engine's WAV cross the capture boundary.
func nativeFrameTicks(firstTick, count, fps int) []float64 {
	ticks := make([]float64, count)
	for i := range ticks {
		ticks[i] = float64(firstTick) + float64(i)*tickrate/float64(fps)
	}
	return ticks
}

func nativeFPS(segs []segment) int {
	speed := 1.0
	for _, s := range segs {
		if s.Speed > 0 && s.Speed < speed {
			speed = s.Speed
		}
	}
	return int(math.Ceil(outputFPS / speed))
}

// Dedicated Selkies desktops can use fractional scaling, making a physical
// 1080p output expose only a 720p XWayland desktop. Opt in only on dedicated
// recorders; ordinary desktop users keep their display configuration.
func prepareNativeDisplay(ctx context.Context, width, height int) error {
	if env("AT_NATIVE_DISPLAY_SETUP", "") != "1" {
		return nil
	}
	data, err := exec.CommandContext(ctx, "wlr-randr", "--json").Output()
	if err != nil {
		return fmt.Errorf("native display discovery: %w", err)
	}
	var outputs []struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(data, &outputs); err != nil {
		return err
	}
	for _, output := range outputs {
		if !output.Enabled {
			continue
		}
		mode := fmt.Sprintf("%dx%d", width, height)
		if b, err := exec.CommandContext(ctx, "wlr-randr", "--output", output.Name, "--scale", "1", "--mode", mode).CombinedOutput(); err != nil {
			return fmt.Errorf("native display mode: %w: %s", err, b)
		}
		return nil
	}
	return errors.New("native display setup found no enabled Wayland output")
}

// Patch only the search path, using a private plugin directory. The plugin
// restores gameinfo.gi.backup as soon as it loads. The launcher also restores
// it on failure, so a failed launch does not leave CS2 modified.
var nativeSearchPath = regexp.MustCompile(`(?m)^([\t ]*Game[\t ]+)csgo[\t ]*\r?$`)

func writeNativeFile(path string, data []byte, mode fs.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".at-native-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err := f.Chmod(mode); err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func installNativePlugin(gameDir string) (func(), error) {
	info := filepath.Join(gameDir, "csgo", "gameinfo.gi")
	backup := info + ".backup"
	if _, err := os.Stat(backup); err == nil {
		return nil, fmt.Errorf("%s already exists; restore the previous CS:DM gameinfo backup before recording", backup)
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	original, err := os.ReadFile(info)
	if err != nil {
		return nil, err
	}
	infoStat, err := os.Stat(info)
	if err != nil {
		return nil, err
	}
	if !nativeSearchPath.Match(original) || bytes.Contains(original, []byte("csgo/at-native")) {
		return nil, errors.New("cannot install native plugin: unrecognized or already modified gameinfo.gi search paths")
	}
	plugin := nativePlugin
	if custom := os.Getenv("AT_CSDM_PLUGIN"); custom != "" {
		plugin, err = os.ReadFile(custom)
		if err != nil {
			return nil, err
		}
	}
	bin := filepath.Join(gameDir, "csgo", "at-native", "bin", "linuxsteamrt64")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		return nil, err
	}
	if err := writeNativeFile(filepath.Join(bin, "libserver.so"), plugin, 0o755); err != nil {
		return nil, err
	}
	modified := nativeSearchPath.ReplaceAll(original, []byte("${1}csgo/at-native\n${1}csgo"))
	f, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_WRONLY, infoStat.Mode().Perm())
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(original)
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		_ = os.Remove(backup)
		return nil, err
	}
	restore := func() {
		// If the plugin restored it itself, our backup no longer exists.
		current, err := os.ReadFile(info)
		if err == nil && bytes.Equal(current, modified) {
			if writeNativeFile(info, original, infoStat.Mode().Perm()) != nil {
				return
			}
			_ = os.Remove(backup)
		}
	}
	if err := writeNativeFile(info, modified, infoStat.Mode().Perm()); err != nil {
		_ = os.Remove(backup)
		return nil, err
	}
	return restore, nil
}

// CS:DM's plugin is a WebSocket client. A loopback-only, ephemeral server
// lets the worker reload its JSON action file without the CSDM application,
// database, or a publicly exposed control port.
type nativeBridge struct {
	server *http.Server
	port   string
	mu     sync.Mutex
	conn   *websocket.Conn
	ready  chan struct{}
	once   sync.Once
}

func newNativeBridge() (*nativeBridge, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	b := &nativeBridge{port: strconv.Itoa(listener.Addr().(*net.TCPAddr).Port), ready: make(chan struct{})}
	b.server = &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The plugin's easywsclient build can omit the query when its URL
		// has no slash before '?'. Both root handshakes are game clients on
		// this dedicated loopback endpoint; other roles/paths are rejected.
		role := r.URL.Query().Get("process")
		if r.URL.Path != "/" || (role != "" && role != "game") {
			http.Error(w, "game client required", http.StatusForbidden)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			log.Printf("native plugin WebSocket handshake: %v", err)
			return
		}
		b.mu.Lock()
		if b.conn != nil {
			b.mu.Unlock()
			c.CloseNow()
			return
		}
		b.conn = c
		b.mu.Unlock()
		b.once.Do(func() { close(b.ready) })
		defer c.CloseNow()
		for {
			if _, _, err := c.Read(context.Background()); err != nil {
				return
			}
		}
	})}
	go func() { _ = b.server.Serve(listener) }()
	return b, nil
}

func (b *nativeBridge) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.conn != nil {
		b.conn.CloseNow()
	}
	_ = b.server.Close()
}

func (b *nativeBridge) play(ctx context.Context, demo string) error {
	wait, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	select {
	case <-b.ready:
	case <-wait.Done():
		return fmt.Errorf("CS:DM native plugin did not connect: %w", wait.Err())
	}
	message, _ := json.Marshal(map[string]string{"name": "playdemo", "payload": demo})
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.conn.Write(wait, websocket.MessageText, message)
}

type nativeFiles struct {
	frames []string
	wav    string
	first  int
}

// CS2 writes images to the plugin search path but WAVs to csgo/movie.
func findNativeFiles(gameDir, prefix string) (nativeFiles, error) {
	var out nativeFiles
	imageName := regexp.MustCompile("^" + regexp.QuoteMeta(prefix) + `([0-9]{8})\.tga$`)
	for _, root := range []string{filepath.Join(gameDir, "csgo", "at-native", "movie"), filepath.Join(gameDir, "csgo", "movie")} {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if os.IsNotExist(err) {
				return nil
			}
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if imageName.MatchString(entry.Name()) {
				out.frames = append(out.frames, path)
			}
			if entry.Name() == prefix+".wav" {
				out.wav = path
			}
			return nil
		})
		if err != nil {
			return out, err
		}
	}
	sort.Strings(out.frames)
	if len(out.frames) == 0 || out.wav == "" {
		return out, errors.New("native capture produced no image sequence or WAV; check CS:DM plugin compatibility with this CS2 build")
	}
	out.first, _ = strconv.Atoi(imageName.FindStringSubmatch(filepath.Base(out.frames[0]))[1])
	for i, path := range out.frames {
		n, _ := strconv.Atoi(imageName.FindStringSubmatch(filepath.Base(path))[1])
		if n != out.first+i || filepath.Dir(path) != filepath.Dir(out.frames[0]) {
			return out, errors.New("native capture image sequence has missing or duplicate frames")
		}
	}
	return out, nil
}

func (f nativeFiles) remove() {
	if env("AT_KEEP_SCRATCH", "") != "" {
		return
	}
	for _, p := range f.frames {
		_ = os.Remove(p)
	}
	if f.wav != "" {
		_ = os.Remove(f.wav)
	}
}

// Native work is bounded by game output, not elapsed playback time. A frame
// can take seconds on integrated graphics without being dropped.
func (r *recorder) captureNative(g *game, name string, from, to, fps int, raw, wav string) ([]float64, float64, error) {
	ctx, cancel := context.WithTimeout(r.commandContext(), time.Duration(envPositive("AT_NATIVE_TIMEOUT_SECONDS", 3600))*time.Second)
	defer cancel()
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, 0, err
	}
	prefix := "atnative-" + hex.EncodeToString(random[:])
	// Guard frames make the first/last requested picture independent of
	// tick/frame rounding at the movie boundaries.
	from = max(8, from)
	to += 2
	if g.lastTick > 0 {
		to = min(to, g.lastTick-endMargin)
	}
	if from >= to {
		return nil, 0, errors.New("native capture has an empty tick range")
	}
	// CS2 exports four-byte TGA pixels. Reserve for I420 conversion too,
	// rounded up to leave room for audio and image headers.
	var stat syscall.Statfs_t
	if err := syscall.Statfs(filepath.Join(r.gameDir, "csgo"), &stat); err != nil {
		return nil, 0, err
	}
	required := uint64(math.Ceil(float64(to-from)/tickrate*float64(fps))) * uint64(g.width*g.height) * 6
	if uint64(stat.Bavail)*uint64(stat.Bsize) < required+(512<<20) {
		return nil, 0, fmt.Errorf("native capture needs approximately %.1f GiB free on the CS2 filesystem", float64(required)/(1<<30))
	}
	jsonPath := g.demoPath + ".json"
	sequences := nativeActions(from, to, fps, prefix, name, r.look())
	// Preserve the moment's TrueView override, set by recordMoment.
	if g.nativePredict != "" {
		// Last setting at tick 1 wins, before seeking away from that tick.
		for i := range sequences[0].Actions {
			if strings.HasPrefix(sequences[0].Actions[i].Cmd, "cl_demo_predict ") {
				sequences[0].Actions[i].Cmd = g.nativePredict
			}
		}
	}
	data, err := json.Marshal(sequences)
	if err != nil {
		return nil, 0, err
	}
	if err := os.WriteFile(jsonPath, data, 0o600); err != nil {
		return nil, 0, err
	}
	defer os.Remove(jsonPath)
	defer func() { files, _ := findNativeFiles(r.gameDir, prefix); files.remove() }()
	g.con.drain()
	started := time.Now()
	if err := g.native.play(ctx, g.demoPath); err != nil {
		return nil, 0, err
	}
	start := regexp.MustCompile(`\[([0-9]+)\] Executing: startmovie ` + regexp.QuoteMeta(prefix))
	firstTick := -1
	done := "AT_NATIVE_DONE_" + prefix
	progress := time.NewTicker(15 * time.Second)
	defer progress.Stop()
	lastProgress, lastCount := time.Now(), 0
	for {
		select {
		case <-ctx.Done():
			_ = g.con.send("endmovie", "demo_pause", "host_framerate 0")
			return nil, 0, fmt.Errorf("native frame capture: %w", ctx.Err())
		case <-progress.C:
			files, _ := findNativeFiles(r.gameDir, prefix)
			count := len(files.frames)
			if count > lastCount {
				lastProgress, lastCount = time.Now(), count
			}
			if time.Since(lastProgress) > time.Duration(envPositive("AT_NATIVE_STALL_SECONDS", 180))*time.Second {
				_ = g.con.send("endmovie", "demo_pause", "host_framerate 0")
				return nil, 0, fmt.Errorf("native capture stopped producing frames (%d exported); check the CS2/plugin logs", count)
			}
			r.report("recording", name, count, int(math.Ceil(float64(to-from)*float64(fps)/tickrate)))
		case line, ok := <-g.con.lines:
			if !ok {
				return nil, 0, errors.New("CS2 console closed during native capture")
			}
			if m := start.FindStringSubmatch(line); m != nil {
				firstTick, _ = strconv.Atoi(m[1])
			}
			if strings.TrimSpace(line) != done {
				continue
			}
			if firstTick < 0 {
				return nil, 0, errors.New("native capture ended without a startmovie tick")
			}
			files, err := findNativeFiles(r.gameDir, prefix)
			if err != nil {
				return nil, 0, err
			}
			// Reject truncated exports, rather than stretching them to fit.
			want := float64(to-firstTick) * float64(fps) / tickrate
			if math.Abs(float64(len(files.frames))-want) > math.Max(3, float64(fps)/tickrate*2) {
				return nil, 0, fmt.Errorf("native capture exported %d frames, expected about %.0f", len(files.frames), want)
			}
			probe, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", files.wav).Output()
			if err != nil {
				return nil, 0, fmt.Errorf("native audio export: %w", err)
			}
			audioSeconds, err := strconv.ParseFloat(strings.TrimSpace(string(probe)), 64)
			pictureSeconds := float64(len(files.frames)) / float64(fps)
			if err != nil || math.Abs(audioSeconds-pictureSeconds) > 0.25 {
				return nil, 0, fmt.Errorf("native audio/video durations differ: audio %.3fs, picture %.3fs", audioSeconds, pictureSeconds)
			}
			r.rate.fps = float64(len(files.frames)) / time.Since(started).Seconds()
			pattern := filepath.Join(filepath.Dir(files.frames[0]), prefix+"%08d.tga")
			args := []string{"-y", "-hide_banner", "-loglevel", "error", "-framerate", strconv.Itoa(fps), "-start_number", strconv.Itoa(files.first), "-i", pattern, "-an", "-pix_fmt", "yuv420p", "-f", "rawvideo", raw}
			if b, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); err != nil {
				return nil, 0, fmt.Errorf("native frame conversion: %w: %s", err, b)
			}
			info, err := os.Stat(raw)
			if err != nil {
				return nil, 0, err
			}
			if info.Size() != int64(len(files.frames))*int64(g.width*g.height*3/2) {
				return nil, 0, errors.New("native movie dimensions differ from the requested capture size")
			}
			if err := copyFile(files.wav, wav); err != nil {
				return nil, 0, err
			}
			_ = g.con.send("host_framerate 0")
			return nativeFrameTicks(firstTick, len(files.frames), fps), float64(firstTick), nil
		}
	}
}
