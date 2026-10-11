// at-recorder installs and identifies a Linux Docker recorder host.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var version = "dev"
var imagePattern = regexp.MustCompile(`^sivertio/auto-tournament-recorder@sha256:[0-9a-f]{64}$`)

type agent struct {
	root, base, token, name, hostID, hostname string
	http                                      *http.Client
	run                                       func(context.Context, ...string) ([]byte, error)
	wait                                      func(context.Context, time.Duration) error
	restart                                   func(context.Context) error
}

func wait(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
func atomicFile(path string, b []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".at-recorder-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func newAgent(root string) (*agent, error) {
	b, err := os.ReadFile(filepath.Join(root, "config/at-recorder.env"))
	if err != nil {
		return nil, err
	}
	conf := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			conf[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
	hostname, _ := os.Hostname()
	if conf["AT_WORKER_NAME"] == "" {
		conf["AT_WORKER_NAME"] = hostname
	}
	hostID, err := machineID(root)
	if err != nil {
		return nil, err
	}
	a := &agent{hostID: hostID, hostname: hostname, root: root, base: strings.TrimRight(conf["AT_URL"], "/"), token: conf["AT_WORKER_TOKEN"], name: conf["AT_WORKER_NAME"], http: &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}, wait: wait}
	if a.base == "" || a.token == "" || a.name == "" {
		return nil, errors.New("AT_URL, AT_WORKER_TOKEN and AT_WORKER_NAME are required")
	}
	if _, err := platformURL(a.base); err != nil {
		return nil, err
	}
	if !validKey(a.token) {
		return nil, errors.New("invalid recorder key")
	}
	a.restart = func(ctx context.Context) error {
		return exec.CommandContext(ctx, "systemctl", "restart", "at-recorder-agent.service").Run()
	}
	a.run = func(ctx context.Context, args ...string) ([]byte, error) {
		c := exec.CommandContext(ctx, "docker", args...)
		c.Dir = root
		out, err := c.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("docker %s failed: %w", args[0], err)
		}
		return out, nil
	}
	return a, nil
}
func (a *agent) apiPath(ctx context.Context, endpoint string, body any, out any) error {
	var reader io.Reader
	method := "GET"
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
		method = "POST"
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+"/api/game/cs2/recorder/"+endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("X-AT-Recorder", a.name)
	req.Header.Set("Content-Type", "application/json")
	res, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("platform %s HTTP %d", endpoint, res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}
func (a *agent) installed(ctx context.Context) (string, string, error) {
	b, err := a.run(ctx, "inspect", "at-recorder", "--format", "{{.Image}}")
	if err != nil {
		return "", "", err
	}
	b, err = a.run(ctx, "image", "inspect", strings.TrimSpace(string(b)))
	if err != nil {
		return "", "", err
	}
	var rows []struct {
		RepoDigests []string
		Config      struct{ Labels map[string]string }
	}
	if err = json.Unmarshal(b, &rows); err != nil || len(rows) != 1 {
		return "", "", errors.New("cannot read installed image metadata")
	}
	for _, d := range rows[0].RepoDigests {
		if imagePattern.MatchString(d) {
			return d, rows[0].Config.Labels["org.opencontainers.image.revision"], nil
		}
	}
	return "", "", errors.New("installed image has no official recorder digest")
}

// Report identity independently of managed update execution.
func (a *agent) tick(ctx context.Context) error {
	image, revision, err := a.installed(ctx)
	if err != nil {
		return err
	}
	var hello struct {
		Name string `json:"name"`
	}
	if err := a.apiPath(ctx, "hello", map[string]string{"name": a.name, "hostname": a.hostname, "hostId": a.hostID, "agentVersion": version, "image": image, "revision": revision}, &hello); err != nil {
		return err
	}
	if hello.Name != a.name {
		return fmt.Errorf("platform identity differs from local worker name; reconnect before recording")
	}
	return nil
}
func main() {
	root := os.Getenv("AT_RECORDER_ROOT")
	if root == "" {
		root = "/srv/at-recorder"
	}
	if handled, err := cli(root, os.Args[1:]); handled {
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	a, err := newAgent(root)
	if err != nil {
		log.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(root, ".agent.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		log.Fatal(err)
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		log.Fatal("another at-recorder host agent is running")
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	log.Printf("at-recorder host agent %s: %s", version, a.name)
	for ctx.Err() == nil {
		if err = a.tick(ctx); err != nil {
			log.Printf("heartbeat: %v", err)
		}
		updateCtx, cancelUpdate := context.WithTimeout(ctx, 60*time.Minute)
		err = a.managedUpdate(updateCtx)
		cancelUpdate()
		if errors.Is(err, errRestartAgent) {
			os.Exit(85)
		}
		if err != nil {
			log.Printf("managed update: %v", err)
		}
		if a.wait(ctx, time.Minute) != nil {
			break
		}
	}
}

func machineID(root string) (string, error) {
	path := filepath.Join(root, ".host-id")
	b, err := os.ReadFile(path)
	if err == nil {
		id := strings.TrimSpace(string(b))
		if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id) {
			return "", errors.New("invalid persistent installation ID; refusing to replace it")
		}
		return id, nil
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	var raw [16]byte
	if _, err = rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 15) | 64
	raw[8] = (raw[8] & 63) | 128
	id := fmt.Sprintf("%x-%x-%x-%x-%x", raw[:4], raw[4:6], raw[6:8], raw[8:10], raw[10:])
	// Publish a fully written ID with an exclusive hard link: simultaneous setup
	// commands cannot replace it or observe a half-written identity.
	f, err := os.CreateTemp(root, ".installation-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	_, err = f.WriteString(id + "\n")
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err = os.Link(f.Name(), path); errors.Is(err, os.ErrExist) {
		return machineID(root)
	}
	return id, err
}

func platformURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(raw, "\n\r\t ") {
		return nil, errors.New("supply an http(s) platform URL without credentials, query or fragment")
	}
	return u, nil
}
func validKey(key string) bool {
	return len(key) > 0 && len(key) <= 4096 && regexp.MustCompile(`^[a-zA-Z0-9._-]+$`).MatchString(key)
}
