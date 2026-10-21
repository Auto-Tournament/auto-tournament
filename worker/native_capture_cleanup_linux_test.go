//go:build linux

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestNativeCancellationWaitsForExportFlush(t *testing.T) {
	testNativeCancellationCleanup(t, true)
}

func TestNativeCancellationRetainsUnconfirmedExport(t *testing.T) {
	testNativeCancellationCleanup(t, false)
}

func testNativeCancellationCleanup(t *testing.T, confirm bool) {
	t.Helper()
	t.Setenv("AT_KEEP_SCRATCH", "")
	dir := t.TempDir()
	images := filepath.Join(dir, "csgo", "at-native", "movie")
	if err := os.MkdirAll(images, 0755); err != nil {
		t.Fatal(err)
	}
	b, err := newNativeBridge()
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	peer, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+b.port+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.CloseNow()
	reader, writer := net.Pipe()
	defer reader.Close()
	defer writer.Close()
	g := &game{native: b, demoPath: filepath.Join(dir, "test.dem"), width: 16, height: 16,
		con: &console{conn: writer, lines: make(chan string, 8)}}
	r := &recorder{gameDir: dir, jobContext: ctx}
	pluginErr := make(chan error, 1)
	go func() {
		if _, _, err := peer.Read(ctx); err != nil {
			pluginErr <- err
			return
		}
		data, err := os.ReadFile(g.demoPath + ".json")
		if err != nil {
			pluginErr <- err
			return
		}
		var sequences []nativeSequence
		if err := json.Unmarshal(data, &sequences); err != nil {
			pluginErr <- err
			return
		}
		var prefix string
		for _, action := range sequences[0].Actions {
			if strings.HasPrefix(action.Cmd, "startmovie ") {
				prefix = strings.TrimPrefix(action.Cmd, "startmovie ")
			}
		}
		if prefix == "" {
			pluginErr <- errors.New("missing export prefix")
			return
		}
		first := filepath.Join(images, prefix+"00000000.tga")
		if err := os.WriteFile(first, nil, 0600); err != nil {
			pluginErr <- err
			return
		}
		cancel()
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			if !strings.HasPrefix(scanner.Text(), "echo AT_NATIVE_STOPPED_") {
				continue
			}
			if _, err := os.Stat(first); err != nil {
				pluginErr <- errors.New("frames removed before export stopped")
				return
			}
			if err := os.WriteFile(filepath.Join(images, prefix+"00000001.tga"), nil, 0600); err != nil {
				pluginErr <- err
				return
			}
			marker := strings.TrimPrefix(scanner.Text(), "echo ")
			g.con.lines <- "Native: Executing: echo " + marker
			if confirm {
				g.con.lines <- marker
			} else {
				close(g.con.lines)
			}
			pluginErr <- nil
			return
		}
		pluginErr <- scanner.Err()
	}()
	_, _, err = r.captureNative(g, "player", 100, 162, 60, filepath.Join(dir, "out.yuv"), filepath.Join(dir, "out.wav"))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	if err := <-pluginErr; err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(images)
	want := 2
	if confirm {
		want = 0
	}
	if err != nil || len(entries) != want {
		t.Fatalf("export cleanup (confirmed=%v): %v, %v", confirm, entries, err)
	}
}
