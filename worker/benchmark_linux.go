package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// benchmarkTry is one refresh rate of a benchmark, and how it went.
type benchmarkTry struct {
	GamescopeHz int      `json:"gamescopeHz"`
	Seconds     *float64 `json:"seconds,omitempty"`
	CaptureFps  *float64 `json:"captureFps,omitempty"`
	RepeatPct   *float64 `json:"repeatPct,omitempty"`
	JumpPct     *float64 `json:"jumpPct,omitempty"`
	OK          bool     `json:"ok"`
	Error       string   `json:"error,omitempty"`
}

// pinnedHz is AT_GAMESCOPE_HZ as the recorder was started with: set by hand,
// it wins over the benchmark.
var pinnedHz = os.Getenv("AT_GAMESCOPE_HZ")

// applySettings uses the refresh rate the platform keeps for this recorder
// (its benchmark's pick), unless AT_GAMESCOPE_HZ was set by hand.
func applySettings(s *recorderSettings) {
	if pinnedHz != "" {
		return
	}
	if s != nil && s.GamescopeHz > 0 {
		os.Setenv("AT_GAMESCOPE_HZ", strconv.Itoa(s.GamescopeHz))
	} else {
		os.Unsetenv("AT_GAMESCOPE_HZ")
	}
}

var (
	gpuOnce sync.Once
	gpu     string
)

// recorderGPU is gpuName, looked up once.
func recorderGPU() string {
	gpuOnce.Do(func() { gpu = gpuName() })
	return gpu
}

// runBenchmark records the platform's benchmark moment once per refresh rate
// it asks for (only the hand-set one when AT_GAMESCOPE_HZ is pinned), timing
// each take and checking its frames, and reports them. The platform keeps
// the fastest smooth rate and sends it with every job after.
func (r *recorder) runBenchmark(ctx context.Context, mj *mapJob) {
	started := time.Now()
	run := jobRun{Kind: "benchmark", MatchSlug: mj.MatchSlug, MapNumber: intPtr(mj.MapNumber)}
	tries, err := r.benchmarkTries(ctx, mj)
	if err != nil {
		run.Error = err.Error()
		log.Printf("benchmark: %v", err)
	}
	res, perr := r.postJSON(ctx, "/api/game/cs2/recorder/benchmark", map[string]any{"recorder": r.worker, "tries": tries})
	if perr == nil {
		var body struct {
			GamescopeHz *int `json:"gamescopeHz"`
		}
		if ok(res, "benchmark") == nil {
			_ = json.NewDecoder(res.Body).Decode(&body)
			if body.GamescopeHz != nil {
				applySettings(&recorderSettings{GamescopeHz: *body.GamescopeHz})
				log.Printf("benchmark: the platform picked %d Hz", *body.GamescopeHz)
			} else {
				log.Printf("benchmark: no smooth setting found")
			}
		}
		res.Body.Close()
	} else if run.Error == "" {
		run.Error = perr.Error()
	}
	run.OK = run.Error == ""
	for _, t := range tries {
		if t.OK {
			run.Clips++
		}
	}
	r.reportRun(run, started)
}

func (r *recorder) benchmarkTries(ctx context.Context, mj *mapJob) ([]benchmarkTry, error) {
	r.useQuality(mj.Quality)
	if len(mj.Players) == 0 || len(mj.Players[0].Moments) == 0 {
		return nil, fmt.Errorf("the benchmark job has no moment")
	}
	dir, err := os.MkdirTemp(r.scratch, "benchmark-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	demoPath := filepath.Join(dir, "match.dem")
	if err := r.download(ctx, mj.MatchSlug, mj.MapNumber, demoPath); err != nil {
		return nil, err
	}
	p := &mj.Players[0]
	name, err := demoName(demoPath, p.PlayerID)
	if err != nil {
		return nil, err
	}
	look := r.lookFor(ctx, p)
	shots := []shot{{m: p.Moments[0], player: 0, name: name, look: look}}

	rates := []int{}
	if pinnedHz != "" {
		hz, _ := strconv.Atoi(pinnedHz)
		rates = append(rates, hz)
	} else {
		for _, t := range mj.Tries {
			rates = append(rates, t.GamescopeHz)
		}
	}
	defer applySettings(mj.Settings)
	var out []benchmarkTry
	for i, hz := range rates {
		t := benchmarkTry{GamescopeHz: hz}
		if pinnedHz == "" {
			os.Setenv("AT_GAMESCOPE_HZ", strconv.Itoa(hz))
		}
		take := filepath.Join(dir, fmt.Sprintf("take-%d", i))
		if err := os.MkdirAll(take, 0o755); err != nil {
			return out, err
		}
		t0 := time.Now()
		clips, failed, err := r.recordMoments(ctx, demoPath, shots, take)
		secs := time.Since(t0).Seconds()
		switch {
		case err != nil:
			t.Error = err.Error()
		case len(clips) == 0 && len(failed) > 0:
			t.Error = failed[0].err.Error()
		case len(clips) == 0:
			t.Error = "no clip"
		default:
			t.Seconds = &secs
			fps := r.rate.fps
			t.CaptureFps = &fps
			if q, qerr := frameCheck(ctx, clips[0].path); qerr == nil {
				t.RepeatPct, t.JumpPct = &q.RepeatPct, &q.JumpPct
				t.OK = true
			} else {
				t.Error = qerr.Error()
			}
		}
		if t.OK {
			log.Printf("benchmark %d Hz: %.0fs, %.0f fps capture, %.1f%% repeated frames", hz, secs, *t.CaptureFps, *t.RepeatPct)
		} else {
			log.Printf("benchmark %d Hz: %s", hz, t.Error)
		}
		out = append(out, t)
	}
	return out, nil
}
