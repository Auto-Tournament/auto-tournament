package main

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"log"
	"strconv"
	"sync"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
)

// benchAssets holds the shipped benchmark demo, assets/benchmark/bench.dem,
// when the build has one (the README keeps the pattern matching without it).
//
//go:embed assets/benchmark
var benchAssets embed.FS

// bundledBenchDemo is the shipped benchmark demo, or nil.
func bundledBenchDemo() []byte {
	b, err := benchAssets.ReadFile("assets/benchmark/bench.dem")
	if err != nil || len(b) == 0 {
		return nil
	}
	return b
}

// benchMoment finds the benchmark clip in a demo: the first kill by a human
// (a player, not a bot; the victim may be a bot), from a few seconds before it
// to a couple after. It returns the killer as a one-moment job.
func benchMoment(r io.Reader) (*recordJob, error) {
	p := dem.NewParser(r)
	defer p.Close()
	var job *recordJob
	p.RegisterEventHandler(func(e events.Kill) {
		if job != nil || e.Killer == nil || e.Killer.IsBot || e.Killer.SteamID64 == 0 {
			return
		}
		if e.Victim != nil && e.Victim.SteamID64 == e.Killer.SteamID64 {
			return
		}
		rate := p.TickRate()
		if rate <= 0 {
			rate = 64
		}
		tick := p.GameState().IngameTick()
		start := tick - int(5*rate)
		if start < 1 {
			start = 1
		}
		job = &recordJob{
			PlayerID:   strconv.FormatUint(e.Killer.SteamID64, 10),
			PlayerName: e.Killer.Name,
			Moments: []moment{{
				ID: 1, Kind: "benchmark", Title: "Benchmark", Round: 1,
				StartTick: start, EndTick: tick + int(2*rate), SlowmoTick: tick, KillTicks: []int{tick},
			}},
		}
	})
	for job == nil {
		more, err := p.ParseNextFrame()
		if err != nil {
			return nil, fmt.Errorf("benchmark demo: %w", err)
		}
		if !more {
			break
		}
	}
	if job == nil {
		return nil, fmt.Errorf("benchmark demo: no kill by a player")
	}
	return job, nil
}

var (
	benchOnce sync.Once
	benchJob  *recordJob
	benchErr  error
)

// bundledBenchmark is the shipped demo's benchmark clip (found once), or nil
// without one.
func bundledBenchmark() ([]byte, *recordJob, error) {
	b := bundledBenchDemo()
	if b == nil {
		return nil, nil, nil
	}
	benchOnce.Do(func() {
		benchJob, benchErr = benchMoment(bytes.NewReader(b))
		if benchErr != nil {
			log.Printf("the shipped benchmark demo: %v", benchErr)
		}
	})
	if benchJob == nil {
		return b, nil, benchErr
	}
	job := *benchJob
	return b, &job, nil
}

// hasBenchDemo: the shipped benchmark demo is here and has its clip.
func hasBenchDemo() bool {
	_, job, err := bundledBenchmark()
	return job != nil && err == nil
}
