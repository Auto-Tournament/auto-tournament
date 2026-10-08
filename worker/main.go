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
//	AT_CS2_DIR       a CS2 install's game/csgo, read-only: the worker sends the
//	                 platform each map's radar for the 2D replay (optional)
//	AT_WORKSHOP_DIRS more directories with workshop map .vpk files, colon-separated
//
// `at-worker analyze <file.dem> [map]` reads one demo and prints the analysis;
// `at-worker export-hud <game/csgo> <out> [weapons|deathnotice|ui...]` writes the
// kill feed's icons from the game (hud.go); `at-worker hud-list <game/csgo> [prefix]`
// lists what pak01 holds under a folder; `at-worker hud-cat <game/csgo> <path>` prints one file.
// `at-worker radars <game/csgo> [workshop dirs...]` lists the radars it would send;
// `at-worker record` records highlight clips instead (record.go).
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

// firstToken is the secret of the first API_TOKENS entry. Entries are split
// by commas, semicolons or whitespace, and each is `label:secret` or a bare
// secret (api/src/utils/serviceTokens.ts).
func firstToken(raw string) string {
	for _, entry := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
	}) {
		if i := strings.Index(entry, ":"); i >= 0 {
			entry = entry[i+1:]
		}
		if entry = strings.TrimSpace(entry); entry != "" {
			return entry
		}
	}
	return ""
}

func (c *client) do(ctx context.Context, method, path, contentType string, body io.Reader) (*http.Response, error) {
	return c.doWith(ctx, method, path, contentType, body, nil)
}

// doWith is do with extra request headers.
func (c *client) doWith(ctx context.Context, method, path, contentType string, body io.Reader, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
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

	if len(os.Args) >= 4 && os.Args[1] == "join-reel" {
		if err := joinReelFiles(os.Args[2], os.Args[3:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 2 && os.Args[1] == "mark-cheers" {
		if err := markCheers(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 2 && os.Args[1] == "record-demo" {
		if err := recordDemo(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 2 && os.Args[1] == "redress" {
		if err := redressFile(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 2 && os.Args[1] == "record-file" {
		if err := recordFile(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 3 && os.Args[1] == "hud-list" {
		prefix := "panorama/images/"
		if len(os.Args) >= 4 {
			prefix = os.Args[3]
		}
		if err := hudList(os.Args[2], prefix); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 4 && os.Args[1] == "hud-cat" {
		if err := hudCat(os.Args[2], os.Args[3]); err != nil {
			log.Fatal(err)
		}
		return
	}

	if len(os.Args) >= 4 && os.Args[1] == "export-hud" {
		groups := map[string]bool{}
		for _, g := range os.Args[4:] {
			groups[g] = true
		}
		icons, err := exportHud(os.Args[2], os.Args[3], groups)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("exported %d icons to %s", len(icons), os.Args[3])
		return
	}

	if len(os.Args) >= 3 && os.Args[1] == "radars" {
		radars, _ := localRadars(os.Args[2], os.Args[3:])
		for key, r := range radars {
			fmt.Printf("%-32s pos %v,%v scale %v crc %08x\n", key, r.PosX, r.PosY, r.Scale, r.CRC)
		}
		return
	}

	token := env("AT_WORKER_TOKEN", firstToken(os.Getenv("API_TOKENS")))
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
	if len(os.Args) >= 2 && os.Args[1] == "record" {
		if err := runRecorder(ctx, c, time.Duration(poll)*time.Second); err != nil {
			log.Fatal(err)
		}
		return
	}
	log.Printf("analyzer v%d, platform %s", AnalyzerVersion, c.base)

	// Radars for the 2D replay, from the game's own files: now, then every 6 hours.
	if cs2Dir := env("AT_CS2_DIR", ""); cs2Dir != "" {
		var workshop []string
		if w := env("AT_WORKSHOP_DIRS", ""); w != "" {
			workshop = strings.Split(w, ":")
		}
		go func() {
			for {
				if err := c.SyncRadars(ctx, cs2Dir, workshop); err != nil {
					log.Printf("radars: %v", err)
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(6 * time.Hour):
				}
			}
		}()
	}

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
