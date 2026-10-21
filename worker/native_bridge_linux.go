//go:build linux

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The native plugin is a WebSocket client. A loopback-only, ephemeral server
// lets the worker reload its JSON action file without a public control port.
type nativeBridge struct {
	server  *http.Server
	port    string
	mu      sync.Mutex
	conn    *websocket.Conn
	changed chan struct{}
}

func newNativeBridge() (*nativeBridge, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	b := &nativeBridge{
		port:    strconv.Itoa(listener.Addr().(*net.TCPAddr).Port),
		changed: make(chan struct{}),
	}
	b.server = &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler:           http.HandlerFunc(b.handlePluginConnection),
	}
	go func() { _ = b.server.Serve(listener) }()
	return b, nil
}

func (b *nativeBridge) handlePluginConnection(w http.ResponseWriter, r *http.Request) {
	// A plugin WebSocket client can omit the query when its URL
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
	close(b.changed)
	b.changed = make(chan struct{})
	b.mu.Unlock()
	defer c.CloseNow()
	defer func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if b.conn == c {
			b.conn = nil
			close(b.changed)
			b.changed = make(chan struct{})
		}
	}()
	for {
		if _, _, err := c.Read(context.Background()); err != nil {
			return
		}
	}
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
	message, _ := json.Marshal(map[string]string{"name": "playdemo", "payload": demo})
	for {
		b.mu.Lock()
		conn, changed := b.conn, b.changed
		b.mu.Unlock()
		if conn != nil {
			if err := conn.Write(wait, websocket.MessageText, message); err == nil {
				return nil
			}
			// A map change may reconnect the plugin. Never keep writing to the
			// first connection after its read loop has closed it.
		}
		select {
		case <-changed:
		case <-wait.Done():
			return fmt.Errorf("native recorder plugin did not connect: %w", wait.Err())
		}
	}
}
