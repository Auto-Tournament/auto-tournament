// Command at-worker is the Auto Tournament worker: it asks the platform for a
// demo to analyze, downloads it, reads it (analyze.go) and sends the numbers
// and the 2D replay back. One demo at a time; it sleeps while there is
// nothing to do.
//
// Environment:
//
//	AT_URL           the platform, e.g. http://auto-tournament:3000
//	AT_WORKER_TOKEN  an API token (else the first of API_TOKENS)
//	AT_POLL_SECONDS  how long to wait when there is no work (default 30)
//
// `at-worker analyze <file.dem> [map]` reads one demo and prints the analysis.
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type job struct {
	MatchSlug string `json:"matchSlug"`
	MapNumber int    `json:"mapNumber"`
	MapName   string `json:"mapName"`
}

type client struct {
	base   string
	token  string
	worker string
	http   *http.Client
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func (c *client) do(ctx context.Context, method, path, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.http.Do(req)
}

func (c *client) postJSON(ctx context.Context, path string, v any) (*http.Response, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return c.do(ctx, http.MethodPost, path, "application/json", bytes.NewReader(b))
}

func ok(res *http.Response, what string) error {
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
	return fmt.Errorf("%s: HTTP %d %s", what, res.StatusCode, strings.TrimSpace(string(b)))
}

func (c *client) claim(ctx context.Context) (*job, error) {
	res, err := c.postJSON(ctx, "/api/game/cs2/demo-worker/claim", map[string]any{"worker": c.worker, "analyzerVersion": AnalyzerVersion})
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if err := ok(res, "claim"); err != nil {
		return nil, err
	}
	var body struct {
		Job *job `json:"job"`
	}
	return body.Job, json.NewDecoder(res.Body).Decode(&body)
}

func jobPath(j *job) string {
	return "/api/game/cs2/demo-worker/jobs/" + url.PathEscape(j.MatchSlug) + "/" + strconv.Itoa(j.MapNumber)
}

func (c *client) work(ctx context.Context, j *job) error {
	res, err := c.do(ctx, http.MethodGet, "/api/demos/"+url.PathEscape(j.MatchSlug)+"/download/"+strconv.Itoa(j.MapNumber), "", nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := ok(res, "download"); err != nil {
		return err
	}
	// The parser reads as it downloads; no copy on disk.
	started := time.Now()
	analysis, replay, err := Analyze(res.Body, j.MapName)
	if err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	log.Printf("%s map %d: %d rounds, %d kills in %s", j.MatchSlug, j.MapNumber, len(analysis.Rounds), len(analysis.Kills), time.Since(started).Round(time.Millisecond))

	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	if err := json.NewEncoder(zw).Encode(replay); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	rr, err := c.do(ctx, http.MethodPut, jobPath(j)+"/replay", "application/gzip", &gz)
	if err != nil {
		return err
	}
	rr.Body.Close()
	if err := ok(rr, "replay"); err != nil {
		return err
	}
	ar, err := c.postJSON(ctx, jobPath(j)+"/result", map[string]any{"worker": c.worker, "analysis": analysis})
	if err != nil {
		return err
	}
	defer ar.Body.Close()
	return ok(ar, "result")
}

func (c *client) fail(ctx context.Context, j *job, cause error) {
	log.Printf("%s map %d failed: %v", j.MatchSlug, j.MapNumber, cause)
	msg := cause.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	if res, err := c.postJSON(ctx, jobPath(j)+"/fail", map[string]any{"worker": c.worker, "error": msg}); err == nil {
		res.Body.Close()
	}
}

func analyzeFile(path, mapName string) {
	f, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	started := time.Now()
	analysis, replay, err := Analyze(f, mapName)
	if err != nil {
		log.Fatal(err)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(analysis)
	r, _ := json.Marshal(replay)
	log.Printf("%d rounds, %d kills, %d frames (%d bytes) in %s", len(analysis.Rounds), len(analysis.Kills), len(replay.Frames), len(r), time.Since(started).Round(time.Millisecond))
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	log.SetPrefix("[worker] ")
	if len(os.Args) >= 3 && os.Args[1] == "analyze" {
		mapName := ""
		if len(os.Args) >= 4 {
			mapName = os.Args[3]
		}
		analyzeFile(os.Args[2], mapName)
		return
	}

	token := env("AT_WORKER_TOKEN", strings.TrimSpace(strings.Split(os.Getenv("API_TOKENS"), ",")[0]))
	if token == "" {
		log.Fatal("Set AT_WORKER_TOKEN (or API_TOKENS) to an API token of the platform.")
	}
	poll, _ := strconv.Atoi(env("AT_POLL_SECONDS", "30"))
	if poll < 5 {
		poll = 5
	}
	host, _ := os.Hostname()
	c := &client{
		base:   strings.TrimRight(env("AT_URL", "http://auto-tournament:3000"), "/"),
		token:  token,
		worker: fmt.Sprintf("%s:%d", host, os.Getpid()),
		http:   &http.Client{Timeout: 10 * time.Minute},
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("analyzer v%d, platform %s", AnalyzerVersion, c.base)

	for ctx.Err() == nil {
		j, err := c.claim(ctx)
		if err != nil {
			log.Printf("cannot reach the platform: %v", err)
		}
		if j == nil {
			select {
			case <-ctx.Done():
			case <-time.After(time.Duration(poll) * time.Second):
			}
			continue
		}
		if err := c.work(ctx, j); err != nil {
			c.fail(context.Background(), j, err)
		}
	}
}
