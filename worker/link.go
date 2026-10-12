package main

// The recorder's live link to the platform (api: demos/recorderLink.ts): one
// WebSocket it keeps open, out from the recorder, so it works from any LAN.
// The platform wakes it the moment there is work (instead of the next poll)
// and can cancel its job; the recorder streams what it is doing for the
// Recorders page and the match pages.
//
// The HTTP routes stay the truth: claims, heartbeats, uploads and reports go
// over them as before. Without the link (an older platform, a dropped
// connection) the recorder just polls, as it always did.

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// linkProtocol is what the recorder says in its hello.
const linkProtocol = 9

// Progress is what the recorder is doing: step (recording, encoding,
// uploading, joining, redressing, benchmark, starting), what (detail), the
// job (match, map), which clip of how many, and how far.
type Progress struct {
	Step      string   `json:"step"`
	Detail    string   `json:"detail,omitempty"`
	MatchSlug string   `json:"matchSlug,omitempty"`
	MapNumber *int     `json:"mapNumber,omitempty"`
	Done      *int     `json:"done,omitempty"`
	Total     *int     `json:"total,omitempty"`
	Percent   *float64 `json:"percent,omitempty"`
	Elapsed   *float64 `json:"elapsed,omitempty"`
	ETA       *float64 `json:"eta,omitempty"`
}

type recorderLink struct {
	c *client
	// wake: the platform says there may be work.
	wake chan struct{}

	mu      sync.Mutex
	conn    *websocket.Conn
	cancel  context.CancelFunc // the current job's, for a platform cancel
	pending *Progress          // the latest progress not yet sent
	idle    bool               // say idle once when nothing is pending
	kick    chan struct{}
}

func newRecorderLink(c *client) *recorderLink {
	return &recorderLink{c: c, wake: make(chan struct{}, 1), kick: make(chan struct{}, 1)}
}

// linkURL is the platform's link address: http(s) → ws(s).
func linkURL(base string) string {
	u := strings.TrimRight(base, "/") + "/api/game/cs2/recorder/link"
	switch {
	case strings.HasPrefix(u, "https://"):
		return "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		return "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u
}

// Linked: the link is up right now.
func (l *recorderLink) Linked() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.conn != nil
}

// run keeps the link up until ctx ends: connect, hello, read; again after a
// drop, waiting longer each time (up to a minute).
func (l *recorderLink) run(ctx context.Context) {
	backoff := 2 * time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := l.session(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) > time.Minute {
			backoff = 2 * time.Second
		}
		if err != nil {
			log.Printf("platform link: %v (polling until it is back)", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < time.Minute {
			backoff *= 2
		}
	}
}

func (l *recorderLink) session(ctx context.Context) error {
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(dialCtx, linkURL(l.c.base), &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + l.c.token}},
	})
	if res != nil && res.Body != nil {
		res.Body.Close()
	}
	if err != nil {
		return err
	}
	conn.SetReadLimit(64 * 1024)
	defer conn.CloseNow()
	if err := writeJSON(ctx, conn, map[string]any{"type": "hello", "recorder": l.c.worker, "version": linkProtocol}); err != nil {
		return err
	}
	sessCtx, stop := context.WithCancel(ctx)
	defer stop()
	l.mu.Lock()
	l.conn = conn
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.conn = nil
		l.mu.Unlock()
	}()
	log.Printf("platform link: connected")
	go l.writer(sessCtx, conn)
	// Say where it stands at once: whatever is pending goes out now.
	l.poke()
	for {
		_, data, err := conn.Read(sessCtx)
		if err != nil {
			return err
		}
		var msg struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "wake":
			select {
			case l.wake <- struct{}{}:
			default:
			}
		case "cancel":
			l.mu.Lock()
			cancelJob := l.cancel
			l.mu.Unlock()
			if cancelJob != nil {
				log.Printf("platform link: the platform cancelled the job")
				cancelJob()
			}
		}
	}
}

// writer sends progress: at most once a second, the latest only (a step
// change goes at once).
func (l *recorderLink) writer(ctx context.Context, conn *websocket.Conn) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-l.kick:
		case <-tick.C:
		}
		l.mu.Lock()
		p, idle := l.pending, l.idle
		l.pending, l.idle = nil, false
		l.mu.Unlock()
		var err error
		switch {
		case p != nil:
			b, _ := json.Marshal(p)
			var m map[string]any
			_ = json.Unmarshal(b, &m)
			m["type"] = "progress"
			err = writeJSON(ctx, conn, m)
		case idle:
			err = writeJSON(ctx, conn, map[string]any{"type": "idle"})
		}
		if err != nil {
			return
		}
	}
}

func (l *recorderLink) poke() {
	select {
	case l.kick <- struct{}{}:
	default:
	}
}

// Report what the recorder is doing now. Cheap to call often: progress goes
// out at most once a second (a new step at once), the latest wins.
func (l *recorderLink) Report(p Progress) {
	if l == nil {
		return
	}
	l.mu.Lock()
	prev := l.pending
	stepChanged := prev == nil || prev.Step != p.Step
	l.pending, l.idle = &p, false
	// A new step goes at once; otherwise the writer's tick sends the latest.
	l.mu.Unlock()
	if stepChanged {
		l.poke()
	}
}

// Idle: nothing to do (the page clears its bar).
func (l *recorderLink) Idle() {
	if l == nil {
		return
	}
	l.mu.Lock()
	l.pending, l.idle = nil, true
	l.mu.Unlock()
	l.poke()
}

// Job: what a platform cancel stops while it runs (nil when it ends).
func (l *recorderLink) Job(cancel context.CancelFunc) {
	if l == nil {
		return
	}
	l.mu.Lock()
	l.cancel = cancel
	l.mu.Unlock()
}

// Wait waits for d, a wake from the platform, or ctx.
func (l *recorderLink) Wait(ctx context.Context, d time.Duration) {
	var wake chan struct{}
	if l != nil {
		wake = l.wake
	}
	select {
	case <-ctx.Done():
	case <-time.After(d):
	case <-wake:
	}
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, b)
}

func ptrInt(n int) *int           { return &n }
func ptrFloat(f float64) *float64 { return &f }
