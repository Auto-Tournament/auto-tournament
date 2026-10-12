package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// opsServer answers update/available with the statuses in turn and counts
// update/request calls.
func opsServer(t *testing.T, statuses []string, newer, managed bool, queued int, requests *int) *httptest.Server {
	t.Helper()
	i := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/game/cs2/recorder/update/available":
			status := statuses[min(i, len(statuses)-1)]
			i++
			u := map[string]any{"managed": managed, "status": status, "error": "",
				"image": map[string]any{"installed": "img@sha256:a", "latest": "img@sha256:b", "newer": newer},
				"agent": map[string]any{"installed": "0.1.0", "latest": "0.1.0", "newer": false}}
			if status == "failed" {
				u["error"] = "CS2 did not start"
			}
			json.NewEncoder(w).Encode(u)
		case "/api/game/cs2/recorder/update/request":
			*requests++
			json.NewEncoder(w).Encode(map[string]any{"queued": queued})
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
}

func opsAgent(server *httptest.Server) *agent {
	return &agent{base: server.URL, token: "atr_test", name: "csrender9", http: server.Client(),
		wait: func(context.Context, time.Duration) error { return nil }}
}

func TestUpdateCommandRequestsAndFollows(t *testing.T) {
	requests := 0
	server := opsServer(t, []string{"current", "queued", "updating", "current"}, true, true, 1, &requests)
	defer server.Close()
	var out bytes.Buffer
	if err := opsAgent(server).updateCommand(context.Background(), nil, &out, time.Millisecond, time.Minute); err != nil {
		t.Fatalf("update: %v\n%s", err, out.String())
	}
	if requests != 1 || !strings.Contains(out.String(), "Updated.") || !strings.Contains(out.String(), "updating") {
		t.Fatalf("requests %d, output:\n%s", requests, out.String())
	}
}

func TestUpdateCommandCheckAndUpToDate(t *testing.T) {
	requests := 0
	server := opsServer(t, []string{"current"}, true, true, 1, &requests)
	defer server.Close()
	var out bytes.Buffer
	if err := opsAgent(server).updateCommand(context.Background(), []string{"--check"}, &out, time.Millisecond, time.Minute); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || !strings.Contains(out.String(), "An update is available") {
		t.Fatalf("--check requested an update or said nothing: %d\n%s", requests, out.String())
	}
	current := opsServer(t, []string{"current"}, false, true, 1, &requests)
	defer current.Close()
	out.Reset()
	if err := opsAgent(current).updateCommand(context.Background(), nil, &out, time.Millisecond, time.Minute); err != nil || requests != 0 {
		t.Fatalf("up to date: err %v, requests %d", err, requests)
	}
}

func TestUpdateCommandRefusalsAndFailure(t *testing.T) {
	requests := 0
	unmanaged := opsServer(t, []string{"current"}, true, false, 1, &requests)
	defer unmanaged.Close()
	if err := opsAgent(unmanaged).updateCommand(context.Background(), nil, &bytes.Buffer{}, time.Millisecond, time.Minute); err == nil || requests != 0 {
		t.Fatalf("an unmanaged host was updated: %v, %d", err, requests)
	}
	notQueued := opsServer(t, []string{"current"}, true, true, 0, &requests)
	defer notQueued.Close()
	if err := opsAgent(notQueued).updateCommand(context.Background(), nil, &bytes.Buffer{}, time.Millisecond, time.Minute); err == nil {
		t.Fatal("an update the platform did not queue was reported as started")
	}
	failed := opsServer(t, []string{"current", "updating", "failed"}, true, true, 1, &requests)
	defer failed.Close()
	err := opsAgent(failed).updateCommand(context.Background(), nil, &bytes.Buffer{}, time.Millisecond, time.Minute)
	if err == nil || !strings.Contains(err.Error(), "CS2 did not start") {
		t.Fatalf("a failed update: %v", err)
	}
	if err := opsAgent(failed).updateCommand(context.Background(), []string{"extra"}, &bytes.Buffer{}, time.Millisecond, time.Minute); err == nil {
		t.Fatal("stray argument accepted")
	}
}

func TestRestartOnlyWhenIdleOrConfirmed(t *testing.T) {
	var ran []string
	idle := false
	a := &agent{run: func(_ context.Context, args ...string) ([]byte, error) {
		ran = append(ran, strings.Join(args, " "))
		if args[0] == "exec" && args[len(args)-1] == "/mnt/clips/recorder-idle" && !idle {
			return nil, errors.New("exit 1")
		}
		return nil, nil
	}}
	restarted := func() bool { return strings.Contains(strings.Join(ran, "\n"), "systemctl --user restart") }
	if err := a.restartCommand(context.Background(), nil, strings.NewReader(""), &bytes.Buffer{}); err == nil || restarted() {
		t.Fatal("restarted mid-job without --force")
	}
	if err := a.restartCommand(context.Background(), []string{"--force"}, strings.NewReader("no\n"), &bytes.Buffer{}); err == nil || restarted() {
		t.Fatal("restarted mid-job without a yes")
	}
	if err := a.restartCommand(context.Background(), []string{"--force"}, strings.NewReader("yes\n"), &bytes.Buffer{}); err != nil || !restarted() {
		t.Fatalf("--force + yes did not restart: %v", err)
	}
	ran, idle = nil, true
	if err := a.restartCommand(context.Background(), nil, strings.NewReader(""), &bytes.Buffer{}); err != nil || !restarted() {
		t.Fatalf("idle restart: %v", err)
	}
}

func TestLogSourcesAndScrub(t *testing.T) {
	src := logSources(50, true)
	if len(src) != 2 || src[0][0] != "journalctl" || src[1][0] != "docker" || src[0][len(src[0])-1] != "-f" {
		t.Fatalf("sources: %v", src)
	}
	line := scrubSecrets("AT_WORKER_TOKEN=atr_abc_def password: hunter2 ok")
	for _, leak := range []string{"atr_abc", "hunter2"} {
		if strings.Contains(line, leak) {
			t.Fatalf("leaked %q: %s", leak, line)
		}
	}
	if err := logsCommand(context.Background(), []string{"-n", "0"}, &bytes.Buffer{}); err == nil {
		t.Fatal("-n 0 accepted")
	}
}
