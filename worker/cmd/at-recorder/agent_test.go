package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

const testImage = "sivertio/auto-tournament-recorder@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config/at-recorder.env"), []byte("AT_URL=http://localhost:3069\nAT_WORKER_TOKEN=test-key\nAT_WORKER_NAME=original-host\nAT_POLL_SECONDS=15\n"), 0640); err != nil {
		t.Fatal(err)
	}
	return root
}
func fakeDocker(_ context.Context, args ...string) ([]byte, error) {
	if args[0] == "inspect" {
		return []byte("sha256:local"), nil
	}
	if args[0] == "image" {
		return []byte(`[{"RepoDigests":["` + testImage + `"],"Config":{"Labels":{"org.opencontainers.image.revision":"runtime-build"}}}]`), nil
	}
	return nil, nil
}
func helloServer(t *testing.T, seen *[]map[string]string, status int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/game/cs2/recorder/hello" {
			t.Errorf("unexpected update access: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing recorder auth")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		*seen = append(*seen, body)
		w.WriteHeader(status)
		if status == 200 {
			json.NewEncoder(w).Encode(map[string]string{"name": body["name"]})
		}
	}))
}
func TestIdentityAndSeparateVersionHeartbeat(t *testing.T) {
	root := fixture(t)
	a, err := newAgent(root)
	if err != nil {
		t.Fatal(err)
	}
	a.run = fakeDocker
	var seen []map[string]string
	s := helloServer(t, &seen, 200)
	defer s.Close()
	a.base = s.URL
	if err = a.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	a.hostname = "renamed-host"
	if err = a.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	b, err := newAgent(root)
	if err != nil {
		t.Fatal(err)
	}
	if b.hostID != a.hostID || seen[0]["hostId"] != seen[1]["hostId"] {
		t.Fatal("identity changed")
	}
	if seen[1]["name"] != "original-host" || seen[1]["hostname"] != "renamed-host" || seen[1]["image"] != testImage || seen[1]["revision"] != "runtime-build" || seen[1]["agentVersion"] != version {
		t.Fatal(seen)
	}
}
func TestConnectionPreservesSettingsAndRejectsInjection(t *testing.T) {
	root := fixture(t)
	old, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	got := connectionConfig(old, "https://example.test/", "replacement-key", "new-host")
	if !strings.Contains(string(got), "AT_WORKER_NAME=original-host\nAT_POLL_SECONDS=15") || strings.Count(string(got), "AT_URL=") != 1 {
		t.Fatal(string(got))
	}
	for _, u := range []string{"file:///tmp/key", "https://user:pass@example.test", "https://example.test/?key=secret", "https://example.test/#fragment", "https://example.test/\nAT_WORKER_NAME=bad"} {
		if _, err := platformURL(u); err == nil {
			t.Fatalf("accepted %q", u)
		}
	}
	for _, k := range []string{"", "key\nAT_URL=bad", "key'", "key with space"} {
		if validKey(k) {
			t.Fatalf("accepted %q", k)
		}
	}
	if err := connect(root, []string{"https://example.test", "new-key"}); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(root, "config/at-recorder.env"))
	if info.Mode().Perm() != 0640 {
		t.Fatal("permissions changed")
	}
	if err := os.WriteFile(filepath.Join(root, ".host-id"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := machineID(root); err == nil {
		t.Fatal("silently replaced invalid ID")
	}
}
func TestAdoptionDoesNotTouchContainerOrCredentials(t *testing.T) {
	root := fixture(t)
	os.WriteFile(filepath.Join(root, "compose.yml"), []byte("existing-compose"), 0600)
	os.Mkdir(filepath.Join(root, "home"), 0700)
	os.WriteFile(filepath.Join(root, "home/steam-login"), []byte("private-login"), 0600)
	before, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	uid, gid, _ := fileOwner(filepath.Join(root, "config/at-recorder.env"))
	var seen []map[string]string
	s := helloServer(t, &seen, 200)
	defer s.Close()
	var calls []string
	r := setupRuntime{root: root, units: t.TempDir(), binary: filepath.Join(root, "source-binary"), owner: "recorder", uid: os.Getuid(), gid: os.Getgid()}
	os.WriteFile(r.binary, []byte("host-binary"), 0700)
	r.agent = func(root string) (*agent, error) {
		a, e := newAgent(root)
		if e != nil {
			return nil, e
		}
		a.base = s.URL
		a.run = fakeDocker
		return a, nil
	}
	r.run = func(_ context.Context, name string, args, env []string, input []byte) error {
		calls = append(calls, name+" "+strings.Join(args, " "))
		return nil
	}
	if err := r.install(context.Background(), true, false); err != nil {
		t.Fatal(err)
	}
	expected := []string{"systemctl daemon-reload", "systemctl enable at-recorder-agent.service", "systemctl restart at-recorder-agent.service"}
	if !reflect.DeepEqual(calls, expected) {
		t.Fatal(calls)
	}
	after, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	if string(before) != string(after) {
		t.Fatal("credentials changed")
	}
	au, ag, _ := fileOwner(filepath.Join(root, "config/at-recorder.env"))
	if au != uid || ag != gid {
		t.Fatal("credential owner changed")
	}
	for file, want := range map[string]string{"compose.yml": "existing-compose", "home/steam-login": "private-login"} {
		b, _ := os.ReadFile(filepath.Join(root, file))
		if string(b) != want {
			t.Fatalf("changed %s", file)
		}
	}
	if err := r.install(context.Background(), true, false); err != nil {
		t.Fatalf("repeat adoption: %v", err)
	}
	if len(seen) != 2 || seen[0]["hostId"] != seen[1]["hostId"] {
		t.Fatal("repeat setup changed identity")
	}
}
func TestFreshInstallRegistersBeforeStartingAndRejectsAuthFailure(t *testing.T) {
	for _, status := range []int{200, 401} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			root := fixture(t)
			var seen []map[string]string
			s := helloServer(t, &seen, status)
			defer s.Close()
			r := setupRuntime{root: root, units: t.TempDir(), binary: filepath.Join(root, "source"), owner: "recorder", uid: os.Getuid(), gid: os.Getgid()}
			os.WriteFile(r.binary, []byte("binary"), 0700)
			r.agent = func(root string) (*agent, error) {
				a, e := newAgent(root)
				if e != nil {
					return nil, e
				}
				a.base = s.URL
				a.run = fakeDocker
				return a, nil
			}
			started := false
			r.run = func(_ context.Context, name string, args, env []string, input []byte) error {
				if name == "bash" && strings.Contains(string(input), "AT_WORKER_TOKEN=") {
					if len(seen) == 0 {
						t.Fatal("started before registration")
					}
					started = true
					for _, file := range []string{".env", "compose.yml", "config/at-recorder.service"} {
						if err := os.WriteFile(filepath.Join(root, file), []byte("fixture"), 0600); err != nil {
							t.Fatal(err)
						}
					}
				}
				return nil
			}
			// The successful fresh path assigns uid 99's group; this requires root.
			// Exercise all steps through the launch boundary even on developer Macs.
			err := r.install(context.Background(), false, true)
			if status == 401 {
				if err == nil || started {
					t.Fatal("started despite failed registration")
				}
			} else if !started {
				t.Fatalf("did not start: %v", err)
			}
		})
	}
}
func TestDoctorFailsWhenSteamOrPlatformUnavailable(t *testing.T) {
	a, _ := newAgent(fixture(t))
	var seen []map[string]string
	s := helloServer(t, &seen, 503)
	defer s.Close()
	a.base = s.URL
	a.run = func(ctx context.Context, args ...string) ([]byte, error) {
		if strings.Join(args, " ") == "exec at-recorder pgrep -x steam" {
			return nil, errors.New("Steam stopped")
		}
		return fakeDocker(ctx, args...)
	}
	if err := a.doctor(context.Background()); err == nil {
		t.Fatal("doctor hid failure")
	}
}
func TestEmbeddedInstallersMatchWebInstallers(t *testing.T) {
	for _, name := range []string{"setup-host.sh", "start-recorder.sh"} {
		a, err := installers.ReadFile("assets/" + name)
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(filepath.Join("../../../client/public/recorder", name))
		if err != nil {
			t.Fatal(err)
		}
		if string(a) != string(b) {
			t.Fatalf("installer copies differ: %s", name)
		}
	}
}

func TestIdentitySurvivesReconnectAndDirectoryMove(t *testing.T) {
	root := fixture(t)
	before, err := machineID(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := connect(root, []string{"https://new-platform.test", "new-key"}); err != nil {
		t.Fatal(err)
	}
	after, err := machineID(root)
	if err != nil || after != before {
		t.Fatal("reconnect changed identity", err)
	}
	moved := filepath.Join(t.TempDir(), "moved-recorder")
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	a, err := newAgent(moved)
	if err != nil || a.hostID != before {
		t.Fatal("moving state changed identity", err)
	}
}
func TestReconnectNeverRestartsRunningContainer(t *testing.T) {
	root := fixture(t)
	a, _ := newAgent(root)
	old, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	id := a.hostID
	a.run = func(_ context.Context, args ...string) ([]byte, error) {
		if args[0] != "inspect" {
			t.Fatal("unexpected container mutation", args)
		}
		return []byte("running"), nil
	}
	if err := a.reconnect(context.Background(), connectionConfig(old, "https://new-platform.test", "new-key", "renamed"), old); err == nil {
		t.Fatal("running recorder reconnected")
	}
	current, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	if string(current) != string(old) {
		t.Fatal("credentials changed before stop")
	}
	currentID, _ := machineID(root)
	if currentID != id {
		t.Fatal("UUID changed")
	}
}

func TestConcurrentIdentityCreation(t *testing.T) {
	root := t.TempDir()
	var wg sync.WaitGroup
	ids := make(chan string, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := machineID(root)
			if err != nil {
				t.Error(err)
				return
			}
			ids <- id
		}()
	}
	wg.Wait()
	close(ids)
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatal("concurrent setup generated another ID")
		}
	}
}
func TestStoppedReconnectValidatesBeforeRestartAndPreservesIdentity(t *testing.T) {
	for _, status := range []int{200, 401} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			root := fixture(t)
			a, _ := newAgent(root)
			old, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
			id := a.hostID
			var seen []map[string]string
			s := helloServer(t, &seen, status)
			defer s.Close()
			started, restarted := false, false
			a.run = func(ctx context.Context, args ...string) ([]byte, error) {
				if args[0] == "inspect" && args[len(args)-1] == "{{.State.Status}}" {
					return []byte("exited"), nil
				}
				if args[0] == "compose" {
					if len(seen) != 1 {
						t.Fatal("restarted before validation")
					}
					started = true
					return nil, nil
				}
				return fakeDocker(ctx, args...)
			}
			a.restart = func(context.Context) error { restarted = true; return nil }
			err := a.reconnect(context.Background(), connectionConfig(old, s.URL, "test-key", "renamed"), old)
			if status == 200 {
				if err != nil || !started || !restarted {
					t.Fatal(err, started, restarted)
				}
			} else {
				if err == nil || started || restarted {
					t.Fatal("rejected connection changed runtime")
				}
				now, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
				if string(now) != string(old) {
					t.Fatal("credentials not restored")
				}
			}
			currentID, _ := machineID(root)
			if currentID != id {
				t.Fatal("reconnection changed UUID")
			}
		})
	}
}

func TestARejectedKeyForgetsThePlatformAndTheKey(t *testing.T) {
	root := fixture(t)
	a, err := newAgent(root)
	if err != nil {
		t.Fatal(err)
	}
	var stopped []string
	a.run = func(ctx context.Context, args ...string) ([]byte, error) {
		if args[0] == "stop" {
			stopped = append(stopped, args[1])
		}
		return fakeDocker(ctx, args...)
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"success":false,"code":"recorder_key_rejected"}`))
	}))
	defer s.Close()
	a.base = s.URL
	if err = a.tick(context.Background()); !errors.Is(err, errKeyRejected) {
		t.Fatalf("want errKeyRejected, got %v", err)
	}
	if err = a.forget(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stopped, []string{"at-recorder"}) {
		t.Fatalf("the container should stop: %v", stopped)
	}
	b, _ := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	if strings.Contains(string(b), "AT_URL") || strings.Contains(string(b), "AT_WORKER_TOKEN") {
		t.Fatalf("the platform and key should be gone:\n%s", b)
	}
	if !strings.Contains(string(b), "AT_WORKER_NAME=original-host") {
		t.Fatal("the name stays")
	}
	// It starts again unlinked, waiting to be connected.
	again, err := newAgent(root)
	if err != nil || again.base != "" || again.token != "" {
		t.Fatalf("unlinked agent: %v %+v", err, again)
	}
}
