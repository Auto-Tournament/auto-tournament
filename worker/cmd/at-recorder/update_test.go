package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const nextImage = "sivertio/auto-tournament-recorder@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

type updaterFixture struct {
	a                            *agent
	req                          updateRequest
	image                        string
	busy, idle, failNew, lostAck bool
	recreates, pulls, acks       int
}

func updater(t *testing.T) *updaterFixture {
	t.Helper()
	root := fixture(t)
	if err := os.WriteFile(filepath.Join(root, "compose.yml"), []byte("services:\n  at-recorder:\n    image: sivertio/auto-tournament-recorder:next\n    volumes:\n      - ./home:/home/default\n      - ./games:/mnt/games\n      - ./config:/mnt/config\n"), 0640); err != nil {
		t.Fatal(err)
	}
	a, err := newAgent(root)
	if err != nil {
		t.Fatal(err)
	}
	f := &updaterFixture{a: a, req: updateRequest{ID: "req-1", Status: "queued", Image: nextImage}, image: testImage, idle: true}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			if r.URL.Query().Get("protocol") != "1" {
				t.Error("update protocol missing")
			}
			f.req.Busy = f.busy
			json.NewEncoder(w).Encode(f.req)
			return
		}
		var b map[string]string
		json.NewDecoder(r.Body).Decode(&b)
		if b["id"] != f.req.ID {
			w.WriteHeader(409)
			return
		}
		if b["status"] == "updating" && b["image"] != "" {
			t.Error("pending ack must not fabricate installed image")
		}
		if b["status"] == "current" && f.lostAck {
			w.WriteHeader(503)
			return
		}
		if b["status"] == "current" && b["image"] != nextImage {
			t.Error("wrong final installed image")
		}
		f.acks++
		f.req.Status = b["status"]
		w.Write([]byte(`{"success":true}`))
	}))
	t.Cleanup(server.Close)
	a.base = server.URL
	a.run = func(_ context.Context, args ...string) ([]byte, error) {
		switch args[0] {
		case "inspect":
			return []byte("sha256:local"), nil
		case "image":
			return []byte(`[{"RepoDigests":["` + f.image + `"],"Config":{"Labels":{"org.opencontainers.image.revision":"test"}}}]`), nil
		case "pull":
			f.pulls++
			return nil, nil
		case "compose":
			f.recreates++
			compose, _ := os.ReadFile(filepath.Join(root, "compose.yml"))
			if override, err := os.ReadFile(filepath.Join(root, "compose.override.yml")); err == nil && strings.Contains(string(override), "image:") {
				compose = override
			}
			if strings.Contains(string(compose), nextImage) {
				f.image = nextImage
			} else {
				f.image = testImage
			}
			return nil, nil
		case "exec":
			if strings.Contains(strings.Join(args, " "), "recorder-idle") && !f.idle {
				return nil, errors.New("busy worker")
			}
			if f.failNew && f.image == nextImage {
				return nil, errors.New("new desktop broken")
			}
		}
		return nil, nil
	}
	a.wait = func(context.Context, time.Duration) error { return context.DeadlineExceeded }
	return f
}
func TestUpdateDrainsAndAcknowledgesBeforeMutation(t *testing.T) {
	f := updater(t)
	f.busy = true
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.pulls != 0 || f.recreates != 0 || f.req.Status != "updating" {
		t.Fatal("busy recorder changed before draining")
	}
	f.busy = false
	f.idle = false
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.recreates != 0 {
		t.Fatal("idle acknowledgement required")
	}
	f.idle = true
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.recreates != 1 || f.image != nextImage {
		t.Fatal("pinned update not installed")
	}
	f.lostAck = true
	if err := f.a.managedUpdate(context.Background()); err == nil {
		t.Fatal("lost acknowledgement should stay pending")
	}
	f.lostAck = false
	// Simulate a restarted host process: durable state carries the completion.
	restarted, err := newAgent(f.a.root)
	if err != nil {
		t.Fatal(err)
	}
	restarted.base = f.a.base
	restarted.run = f.a.run
	restarted.wait = f.a.wait
	if err := restarted.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.recreates != 1 || f.req.Status != "current" {
		t.Fatal("lost ack caused duplicate container restart")
	}
	if _, err := os.Stat(f.a.journalPath()); !os.IsNotExist(err) {
		t.Fatal("completed journal retained")
	}
}
func TestUpdateRollsBackAndPreservesMountedState(t *testing.T) {
	f := updater(t)
	f.failNew = true
	before, _ := os.ReadFile(filepath.Join(f.a.root, "config/at-recorder.env"))
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.image != testImage || f.recreates != 2 {
		t.Fatal("failed image was not rolled back")
	}
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.req.Status != "failed" {
		t.Fatal("failed update not reported")
	}
	after, _ := os.ReadFile(filepath.Join(f.a.root, "config/at-recorder.env"))
	if string(before) != string(after) {
		t.Fatal("credentials changed")
	}
	compose, _ := os.ReadFile(filepath.Join(f.a.root, "compose.yml"))
	for _, volume := range []string{"./home:/home/default", "./games:/mnt/games", "./config:/mnt/config"} {
		if !strings.Contains(string(compose), volume) {
			t.Fatal("mounted state changed")
		}
	}
}
func TestUpdateDeadlineDoesNotKillActiveJob(t *testing.T) {
	f := updater(t)
	f.busy = true
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(f.a.journalPath())
	var j updateJournal
	json.Unmarshal(b, &j)
	j.Deadline = time.Now().Add(-time.Minute).Unix()
	f.a.saveUpdate(&j)
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.recreates != 0 || f.pulls != 0 || f.req.Status != "failed" {
		t.Fatal("deadline interrupted active work")
	}
}
func TestPinnedComposeRejectsOtherServices(t *testing.T) {
	for _, b := range []string{"services:\n  other:\n    image: postgres:17\n", "services:\n  at-recorder:\n    image: sivertio/auto-tournament-recorder:next\n  db:\n    image: postgres:17\n"} {
		if _, err := pinnedCompose([]byte(b), nextImage); err == nil {
			t.Fatal("unsafe compose accepted")
		}
	}
}

func TestRecoveredAgentReportsFailureOnce(t *testing.T) {
	f := updater(t)
	j := updateJournal{Request: f.req, PreviousImage: testImage, Compose: []byte("services:\n  at-recorder:\n    image: " + testImage + "\n"), Phase: "complete"}
	f.a.saveUpdate(&j)
	os.WriteFile(filepath.Join(f.a.root, ".agent-rollback"), nil, 0600)
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.req.Status != "failed" || f.recreates != 0 {
		t.Fatal("agent rollback looped or restarted unchanged container")
	}
}
func TestNewRequestAfterLostCompletionDoesNotBlockHost(t *testing.T) {
	f := updater(t)
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.req.ID = "next-request"
	f.req.Status = "queued"
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(f.a.journalPath()); !os.IsNotExist(err) {
		t.Fatal("old completed state blocks next request")
	}
	if f.recreates != 1 {
		t.Fatal("old completion restarted container")
	}
}

func TestOrphanedRollbackMarkerDoesNotAffectNewRequest(t *testing.T) {
	f := updater(t)
	for _, name := range []string{".agent-rollback", ".previous-agent", ".next-agent"} {
		os.WriteFile(filepath.Join(f.a.root, name), []byte("orphan"), 0600)
	}
	for i := 0; i < 2; i++ {
		if err := f.a.managedUpdate(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if f.req.Status != "current" || f.recreates != 1 {
		t.Fatal("orphaned cleanup state caused a false rollback")
	}
}

func TestMalformedJournalPreservesRecoveryEvidence(t *testing.T) {
	f := updater(t)
	original := []byte(`{"Phase":"applying"}`)
	os.WriteFile(f.a.journalPath(), original, 0600)
	if err := f.a.managedUpdate(context.Background()); err == nil {
		t.Fatal("malformed persisted request accepted")
	}
	after, _ := os.ReadFile(f.a.journalPath())
	if string(after) != string(original) || f.pulls != 0 || f.recreates != 0 {
		t.Fatal("invalid recovery evidence was overwritten")
	}
}

func TestUpdatePreservesAndPinsLegacyHardwareOverride(t *testing.T) {
	for _, rollback := range []bool{false, true} {
		t.Run(fmt.Sprint("rollback=", rollback), func(t *testing.T) {
			f := updater(t)
			f.failNew = rollback
			override := []byte("services:\n  at-recorder:\n    image: " + testImage + "\n    devices:\n      - /dev/dri/renderD128:/dev/dri/renderD128\n    shm_size: 2g\n")
			path := filepath.Join(f.a.root, "compose.override.yml")
			os.WriteFile(path, override, 0640)
			if err := f.a.managedUpdate(context.Background()); err != nil {
				t.Fatal(err)
			}
			if err := f.a.managedUpdate(context.Background()); err != nil {
				t.Fatal(err)
			}
			want := nextImage
			if rollback {
				want = testImage
			}
			after, _ := os.ReadFile(path)
			expected, _ := pinnedCompose(override, want)
			if string(after) != string(expected) || f.image != want {
				t.Fatal("effective image or hardware override not preserved")
			}
			stat, _ := os.Stat(path)
			if stat.Mode().Perm() != 0640 {
				t.Fatal("override mode changed")
			}
		})
	}
}
func TestUpdateRecoversJournalWithoutOverrideSnapshot(t *testing.T) {
	f := updater(t)
	compose, _ := os.ReadFile(filepath.Join(f.a.root, "compose.yml"))
	os.WriteFile(filepath.Join(f.a.root, "compose.override.yml"), []byte("services:\n  at-recorder:\n    image: "+testImage+"\n    shm_size: 2g\n"), 0640)
	f.a.saveUpdate(&updateJournal{Request: f.req, PreviousImage: testImage, Compose: compose, Phase: "applying"})
	if err := f.a.managedUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.image != nextImage || f.recreates != 1 {
		t.Fatal("old journal still uses the previous override image")
	}
}
