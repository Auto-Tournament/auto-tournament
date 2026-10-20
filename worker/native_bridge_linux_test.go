//go:build linux

package main

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"strings"
	"testing"
	"time"
)

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
	if err := b.play(ctx, "first.dem"); err != nil {
		t.Fatal(err)
	}
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
