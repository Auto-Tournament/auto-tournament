package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A fake platform end of the link: it checks the key and the hello, then
// wakes the recorder, takes its progress and cancels its job.
func TestRecorderLink(t *testing.T) {
	got := make(chan map[string]any, 8)
	send := make(chan string, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/game/cs2/recorder/link" || r.Header.Get("Authorization") != "Bearer atr_test" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		go func() {
			for msg := range send {
				_ = conn.Write(ctx, websocket.MessageText, []byte(msg))
			}
		}()
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var m map[string]any
			_ = json.Unmarshal(data, &m)
			got <- m
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	l := newRecorderLink(&client{base: srv.URL, token: "atr_test", worker: "spec-1"})
	go l.run(ctx)

	next := func() map[string]any {
		select {
		case m := <-got:
			return m
		case <-time.After(5 * time.Second):
			t.Fatal("nothing from the recorder")
			return nil
		}
	}
	hello := next()
	if hello["type"] != "hello" || hello["recorder"] != "spec-1" || hello["version"] != float64(linkProtocol) {
		t.Fatalf("hello: %v", hello)
	}
	for i := 0; i < 50 && !l.Linked(); i++ {
		time.Sleep(20 * time.Millisecond)
	}

	// The platform wakes it: Wait returns at once, not after the hour.
	send <- `{"type":"wake"}`
	start := time.Now()
	l.Wait(ctx, time.Hour)
	if time.Since(start) > 3*time.Second {
		t.Fatal("a wake did not end the wait")
	}

	// Progress goes out (a new step at once).
	l.Report(Progress{Step: "recording", Detail: "ZywOo · 4K", MatchSlug: "m1", Done: ptrInt(2), Total: ptrInt(5)})
	p := next()
	if p["type"] != "progress" || p["step"] != "recording" || p["matchSlug"] != "m1" || p["done"] != float64(2) {
		t.Fatalf("progress: %v", p)
	}

	// A platform cancel stops the job it was given.
	jobCtx, cancelJob := context.WithCancel(ctx)
	l.Job(cancelJob)
	send <- `{"type":"cancel"}`
	select {
	case <-jobCtx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not stop the job")
	}

	// Idle clears it.
	l.Idle()
	if m := next(); m["type"] != "idle" {
		t.Fatalf("idle: %v", m)
	}
}

func TestLinkURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://cs.sivert.io":  "wss://cs.sivert.io/api/game/cs2/recorder/link",
		"http://10.0.0.5:3069/": "ws://10.0.0.5:3069/api/game/cs2/recorder/link",
	} {
		if got := linkURL(in); got != want {
			t.Errorf("%s: %s, want %s", in, got, want)
		}
	}
}
