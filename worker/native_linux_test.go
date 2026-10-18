//go:build linux

package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
	"google.golang.org/protobuf/proto"
)

func TestConsoleDrainReturnsAfterGameExit(t *testing.T) {
	c := &console{lines: make(chan string, 2)}
	c.lines <- "old output"
	close(c.lines)
	c.drain()
}

func TestNativeBridgeAcceptsLegacyPluginRoot(t *testing.T) {
	b, err := newNativeBridge()
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+b.port+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	if err := b.play(ctx, "/tmp/test.dem"); err != nil {
		t.Fatal(err)
	}
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var msg struct {
		Name    string `json:"name"`
		Payload string `json:"payload"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Name != "playdemo" || msg.Payload != "/tmp/test.dem" {
		t.Fatalf("bad plugin message: %s", data)
	}
}

func TestNativeFrameClockAndSlowMotion(t *testing.T) {
	old := outputFPS
	outputFPS = 60
	t.Cleanup(func() { outputFPS = old })
	segs := []segment{{From: 0, To: 1, Speed: 1}, {From: 1, To: 2, Speed: 0.5}}
	fps := nativeFPS(segs)
	if fps != 120 {
		t.Fatalf("half speed needs 120 frames/game second, got %d", fps)
	}
	ticks := nativeFrameTicks(100, 241, fps)
	frames, err := timeline([][]float64{ticks}, segs, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 180 {
		t.Fatalf("got %d frames, want 180", len(frames))
	}
	for i, frame := range frames {
		want := 100 + float64(i)*64/60
		if i >= 60 {
			want = 164 + float64(i-60)*32/60
		}
		if math.Abs(ticks[frame.index]-want) > 1e-6 {
			t.Fatalf("frame %d has tick %g, want %g", i, ticks[frame.index], want)
		}
	}
}

func TestNativePluginInstallRestoreAndBackupOwnership(t *testing.T) {
	dir := t.TempDir()
	info := filepath.Join(dir, "csgo", "gameinfo.gi")
	if err := os.MkdirAll(filepath.Dir(info), 0o755); err != nil {
		t.Fatal(err)
	}
	original := "GameInfo\n{\n SearchPaths\n {\n\t\tGame\tcsgo\n\t\tGame\tcore\n }\n}\n"
	if err := os.WriteFile(info, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	restore, err := installNativePlugin(dir)
	if err != nil {
		t.Fatal(err)
	}
	modified, _ := os.ReadFile(info)
	if !strings.Contains(string(modified), "Game\tcsgo/at-native") {
		t.Fatalf("plugin search path missing: %s", modified)
	}
	if _, err := installNativePlugin(dir); err == nil {
		t.Fatal("overwrote another installation's backup")
	}
	restore()
	after, _ := os.ReadFile(info)
	if string(after) != original {
		t.Fatalf("gameinfo was not restored: %s", after)
	}
	if _, err := os.Stat(info + ".backup"); !os.IsNotExist(err) {
		t.Fatalf("backup left behind: %v", err)
	}
	// The plugin may already have restored and removed the backup itself.
	restore()
}

func TestNativeActionsOrderAndPlayerEscaping(t *testing.T) {
	sequences := nativeActions(100, 228, 120, "test", "player\";quit\n", []string{"cl_demo_predict 2"})
	last := -1
	var cmds []string
	for _, a := range sequences[0].Actions {
		if a.Tick < last {
			t.Fatalf("actions are out of order: %+v", a)
		}
		if strings.ContainsAny(a.Cmd, ";\r\n") {
			t.Fatalf("injected console command: %q", a.Cmd)
		}
		last = a.Tick
		cmds = append(cmds, a.Cmd)
	}
	joined := strings.Join(cmds, "\n")
	for _, want := range []string{"host_framerate 120", "startmovie test", "endmovie\necho AT_NATIVE_DONE_test\ndemo_pause"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %s", want, joined)
		}
	}
}

func TestNativeFilesRejectMissingImages(t *testing.T) {
	dir := t.TempDir()
	images := filepath.Join(dir, "csgo", "at-native", "movie")
	audio := filepath.Join(dir, "csgo", "movie")
	for _, p := range []string{images, audio} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{filepath.Join(images, "test00000000.tga"), filepath.Join(images, "test00000002.tga"), filepath.Join(audio, "test.wav")} {
		if err := os.WriteFile(p, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := findNativeFiles(dir, "test"); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("missing frame accepted: %v", err)
	}
}

// Exercise the actual WebSocket protocol, JSON actions, exported image/WAV
// discovery and FFmpeg conversion without needing a running CS2 or Steam.
func TestNativeCaptureConvertsEngineExport(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	t.Setenv("AT_KEEP_SCRATCH", "")
	dir := t.TempDir()
	images := filepath.Join(dir, "csgo", "at-native", "movie")
	audio := filepath.Join(dir, "csgo", "movie")
	for _, p := range []string{images, audio} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	b, err := newNativeBridge()
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+b.port+"?process=game", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	consoleReader, consoleWriter := net.Pipe()
	defer consoleReader.Close()
	defer consoleWriter.Close()
	// Drain the final host_framerate reset sent to the console.
	go func() {
		buf := make([]byte, 256)
		for {
			if _, err := consoleReader.Read(buf); err != nil {
				return
			}
		}
	}()
	g := &game{native: b, demoPath: filepath.Join(dir, "test.dem"), width: 16, height: 16, con: &console{conn: consoleWriter, lines: make(chan string, 20)}}
	r := &recorder{gameDir: dir, jobContext: ctx}
	pluginError := make(chan error, 1)
	go func() {
		_, message, err := c.Read(ctx)
		if err != nil {
			pluginError <- err
			return
		}
		var play struct {
			Name    string `json:"name"`
			Payload string `json:"payload"`
		}
		if err := json.Unmarshal(message, &play); err != nil {
			pluginError <- err
			return
		}
		if play.Name != "playdemo" || play.Payload != g.demoPath {
			pluginError <- fmt.Errorf("wrong play message: %s", message)
			return
		}
		data, err := os.ReadFile(play.Payload + ".json")
		if err != nil {
			pluginError <- err
			return
		}
		var sequences []nativeSequence
		if err := json.Unmarshal(data, &sequences); err != nil {
			pluginError <- err
			return
		}
		var prefix string
		for _, a := range sequences[0].Actions {
			if strings.HasPrefix(a.Cmd, "startmovie ") {
				prefix = strings.TrimPrefix(a.Cmd, "startmovie ")
			}
		}
		if prefix == "" {
			pluginError <- fmt.Errorf("no startmovie action")
			return
		}
		// from=100, to=162+2 guard ticks: one second at 60 frames/sec.
		for i := 0; i < 60; i++ {
			tga := make([]byte, 18+16*16*3)
			tga[2] = 2
			binary.LittleEndian.PutUint16(tga[12:14], 16)
			binary.LittleEndian.PutUint16(tga[14:16], 16)
			tga[16] = 24
			for j := 18; j < len(tga); j++ {
				tga[j] = byte(i)
			}
			if err := os.WriteFile(filepath.Join(images, fmt.Sprintf("%s%08d.tga", prefix, i)), tga, 0o600); err != nil {
				pluginError <- err
				return
			}
		}
		wave := make([]byte, 44+48000*2)
		copy(wave, "RIFF")
		binary.LittleEndian.PutUint32(wave[4:8], uint32(len(wave)-8))
		copy(wave[8:], "WAVEfmt ")
		binary.LittleEndian.PutUint32(wave[16:20], 16)
		binary.LittleEndian.PutUint16(wave[20:22], 1)
		binary.LittleEndian.PutUint16(wave[22:24], 1)
		binary.LittleEndian.PutUint32(wave[24:28], 48000)
		binary.LittleEndian.PutUint32(wave[28:32], 96000)
		binary.LittleEndian.PutUint16(wave[32:34], 2)
		binary.LittleEndian.PutUint16(wave[34:36], 16)
		copy(wave[36:], "data")
		binary.LittleEndian.PutUint32(wave[40:44], uint32(len(wave)-44))
		if err := os.WriteFile(filepath.Join(audio, prefix+".wav"), wave, 0o600); err != nil {
			pluginError <- err
			return
		}
		g.con.lines <- "CSDM: [100] Executing: startmovie " + prefix
		g.con.lines <- "CSDM: [164] Executing: echo AT_NATIVE_DONE_" + prefix // must not finish on the log line
		g.con.lines <- "AT_NATIVE_DONE_" + prefix
		pluginError <- nil
	}()
	raw, wav := filepath.Join(dir, "out.yuv"), filepath.Join(dir, "out.wav")
	ticks, first, err := r.captureNative(g, "player", 100, 162, 60, raw, wav)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-pluginError; err != nil {
		t.Fatal(err)
	}
	if len(ticks) != 60 || first != 100 {
		t.Fatalf("bad native clock: first=%v, frames=%d", first, len(ticks))
	}
	info, err := os.Stat(raw)
	if err != nil || info.Size() != 60*16*16*3/2 {
		t.Fatalf("bad I420 conversion: %v %v", info, err)
	}
	if _, err := os.Stat(g.demoPath + ".json"); !os.IsNotExist(err) {
		t.Fatalf("actions left behind: %v", err)
	}
	entries, _ := os.ReadDir(images)
	if len(entries) != 0 {
		t.Fatal("raw TGA files left behind after conversion")
	}
}

func TestNativeDisplayAcceptsLargerBrowserOutput(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	logPath := filepath.Join(dir, "args")
	script := "#!/bin/sh\nif [ \"$1\" = --json ]; then\n echo '[{\"name\":\"WL-1\",\"enabled\":true,\"modes\":[{\"width\":2360,\"height\":1424,\"current\":true}]}]'\nelse\n printf '%s ' \"$@\" > \"" + logPath + "\"\nfi\n"
	if err := os.WriteFile(filepath.Join(dir, "wlr-randr"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("AT_NATIVE_DISPLAY_SETUP", "1")
	if err := prepareNativeDisplay(context.Background(), 1920, 1080); err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(logPath)
	if strings.Contains(string(args), "--mode") || !strings.Contains(string(args), "--scale 1") {
		t.Fatalf("unexpected display request: %s", args)
	}
	if err := prepareNativeDisplay(context.Background(), 3840, 2160); err == nil {
		t.Fatal("accepted undersized display")
	}
}

func TestNativeBridgeReconnectsAfterMapChange(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	b, err := newNativeBridge()
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	first, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+b.port+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	<-b.ready
	first.CloseNow()
	for {
		b.mu.Lock()
		gone := b.conn == nil
		changed := b.changed
		b.mu.Unlock()
		if gone {
			break
		}
		select {
		case <-changed:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	second, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+b.port+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.CloseNow()
	if err := b.play(ctx, "test.dem"); err != nil {
		t.Fatal(err)
	}
	_, message, err := second.Read(ctx)
	if err != nil || !strings.Contains(string(message), "test.dem") {
		t.Fatalf("reconnected message: %s, %v", message, err)
	}
}

func TestNativeBootstrapReadsDemoMap(t *testing.T) {
	header, err := proto.Marshal(&msg.CDemoFileHeader{DemoFileStamp: proto.String("PBDEMS2"), MapName: proto.String("de_mirage"), PatchVersion: proto.Int32(14191)})
	if err != nil {
		t.Fatal(err)
	}
	data := append([]byte("PBDEMS2\x00"), make([]byte, 8)...)
	data = append(data, 1, 0) // DEM_FileHeader, tick 0
	var size [10]byte
	n := binary.PutUvarint(size[:], uint64(len(header)))
	data = append(data, size[:n]...)
	data = append(data, header...)
	path := filepath.Join(t.TempDir(), "match.dem")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := nativeDemoMap(path)
	if err != nil || got != "de_mirage" {
		t.Fatalf("map=%q, error=%v", got, err)
	}
}

func TestNativeFrameDimensionsRejectDesktopSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "frame.tga")
	header := make([]byte, 18)
	binary.LittleEndian.PutUint16(header[12:14], 2360)
	binary.LittleEndian.PutUint16(header[14:16], 1424)
	if err := os.WriteFile(path, header, 0600); err != nil {
		t.Fatal(err)
	}
	if err := checkNativeDimensions(path, 1920, 1080); err == nil || !strings.Contains(err.Error(), "2360x1424") {
		t.Fatalf("wrong-size export accepted: %v", err)
	}
	if err := checkNativeDimensions(path, 2360, 1424); err != nil {
		t.Fatal(err)
	}
}

func TestNativeWindowRulesKeepRequestedSize(t *testing.T) {
	t.Setenv("LABWC_PID", "123")
	dir := t.TempDir()
	path := filepath.Join(dir, "rc.xml")
	original := `<labwc_config><windowRules><windowRule identifier="*"><action name="Maximize" /></windowRule><windowRule identifier="steam" serverDecoration="no" /></windowRules></labwc_config>`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "labwc"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := prepareNativeWindowRules(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	backup, _ := os.ReadFile(path + ".at-native-original")
	if strings.Contains(string(data), "Maximize") || !strings.Contains(string(data), `identifier="steam"`) || string(backup) != original {
		t.Fatalf("unexpected window rules or backup: %s", data)
	}
	if err := prepareNativeWindowRules(context.Background(), path); err != nil {
		t.Fatal(err)
	}
}
