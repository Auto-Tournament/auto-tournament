package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestSendFileInParts(t *testing.T) {
	old := partSize
	partSize = 10
	defer func() { partSize = old }()
	want := []byte("0123456789abcdefghijklmnopqrstuvwxyz")
	var staged, got []byte
	var header string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/game/cs2/recorder/uploads":
			fmt.Fprint(w, `{"success":true,"id":"abc"}`)
		case r.URL.Path == "/api/game/cs2/recorder/uploads/abc":
			if off, _ := strconv.Atoi(r.URL.Query().Get("offset")); off != len(staged) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			if len(body) > 10 {
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				return
			}
			staged = append(staged, body...)
		case r.URL.Path == "/clip":
			header = r.Header.Get("X-AT-Upload")
			got = body
		}
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(path, want, 0o644); err != nil {
		t.Fatal(err)
	}
	c := &client{base: srv.URL, http: srv.Client()}
	res, err := c.sendFile(context.Background(), path, "/clip", "video/mp4", nil)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if header != "abc" || len(got) != 0 || !bytes.Equal(staged, want) {
		t.Fatalf("header %q, body %q, staged %q", header, got, staged)
	}
}

func TestSendFileWithoutParts(t *testing.T) {
	old := partSize
	partSize = 10
	defer func() { partSize = old }()
	want := []byte("0123456789abcdefghijklmnopqrstuvwxyz")
	var got []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/clip" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		got, _ = io.ReadAll(r.Body)
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(path, want, 0o644); err != nil {
		t.Fatal(err)
	}
	c := &client{base: srv.URL, http: srv.Client()}
	res, err := c.sendFile(context.Background(), path, "/clip", "video/mp4", nil)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if !bytes.Equal(got, want) {
		t.Fatalf("an older platform got %q", got)
	}
}
