package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"
)

// runLogMax is how much of one job's log is kept for the platform.
const runLogMax = 256 * 1024

// jobLog keeps the log lines of the job running now, to send with its run
// report (POST /api/game/cs2/recorder/runs): the platform's Recorders page
// shows each run's timings and log.
type jobLog struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

var currentJobLog = &jobLog{}

func (l *jobLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.buf.Len()+len(p) > runLogMax {
		// Keep the newest lines: drop the oldest half.
		keep := l.buf.Bytes()[l.buf.Len()/2:]
		rest := append([]byte("…\n"), keep...)
		l.buf.Reset()
		l.buf.Write(rest)
	}
	return l.buf.Write(p)
}

// take returns the job's log so far and starts an empty one.
func (l *jobLog) take() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := l.buf.String()
	l.buf.Reset()
	return s
}

// jobRun is one job's report to the platform.
type jobRun struct {
	Kind      string  `json:"kind"`
	MatchSlug string  `json:"matchSlug,omitempty"`
	MapNumber *int    `json:"mapNumber,omitempty"`
	StartedAt int64   `json:"startedAt"`
	Seconds   float64 `json:"seconds"`
	OK        bool    `json:"ok"`
	Clips     int     `json:"clips"`
	Rejected  int     `json:"rejected"`
	Error     string  `json:"error,omitempty"`
}

// reportRun sends a finished job's timings and log. Best effort: a platform
// without the route (older) answers 404, which is fine.
func (c *client) reportRun(run jobRun, started time.Time) {
	run.StartedAt = started.Unix()
	run.Seconds = time.Since(started).Seconds()
	body := map[string]any{"recorder": c.worker, "log": currentJobLog.take()}
	b, _ := jsonMap(run)
	for k, v := range b {
		body[k] = v
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := c.postJSON(ctx, "/api/game/cs2/recorder/runs", body)
	if err != nil {
		log.Printf("run report: %v", err)
		return
	}
	res.Body.Close()
}

// heartbeatEvery is how often a recorder at a job tells the platform it is
// still at it: well inside the platform's 30 minutes before a claim goes stale.
const heartbeatEvery = 5 * time.Minute

// heartbeat tells the platform every heartbeatEvery that this recorder is
// still working on what it claimed (a map job can take hours, and its clips
// go up only at the end), so no other recorder takes it over. Returns what
// stops it. Best effort: an older platform answers 404, which is fine.
func (c *client) heartbeat(ctx context.Context) func() {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(heartbeatEvery)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-t.C:
				hctx, cancel := context.WithTimeout(ctx, 30*time.Second)
				if res, err := c.postJSON(hctx, "/api/game/cs2/recorder/heartbeat", map[string]any{"recorder": c.worker}); err == nil {
					res.Body.Close()
				}
				cancel()
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(done) }) }
}

// jsonMap turns a struct into its JSON object's fields.
func jsonMap(v any) (map[string]any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	return m, json.Unmarshal(b, &m)
}
