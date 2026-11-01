package main

// A finished benchmark's result, sent to the website so it can publish what
// hardware renders how fast. Only the fields below, nothing about the match,
// the players or the machine's name (the site refuses anything else, and its
// privacy policy lists them). On by default, says so at startup; AT_TELEMETRY=0
// or the admin setting turn it off; recording works the same whether it arrives or not.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// recorderVersion is what the recorder tells the platform it is.
const recorderVersion = 8

// benchmarkVersion: raise it when the shipped clip or how it is timed changes,
// so old and new results are not compared.
const benchmarkVersion = 1

const recorderStatsURL = "https://autotournament.gg/api/recorder-stats"

type recorderStats struct {
	InstallID        string  `json:"installId"`
	BenchmarkVersion int     `json:"benchmarkVersion"`
	GPUModel         string  `json:"gpuModel"`
	VRAMMb           int     `json:"vramMb"`
	CPUModel         string  `json:"cpuModel"`
	Driver           string  `json:"driver"`
	RecorderVersion  string  `json:"recorderVersion"`
	Resolution       string  `json:"resolution"`
	RecordersPerGPU  int     `json:"recordersPerGpu"`
	Seconds          float64 `json:"seconds"`
	FramesPerSecond  float64 `json:"framesPerSecond"`
	PeakVRAMMb       int     `json:"peakVramMb"`
	FailedTries      int     `json:"failedTries"`
}

// statsOffByAdmin: the platform's setting, sent with every job.
var statsOffByAdmin atomic.Bool

// recordersOnCard is how many recorders share this one's GPU: what the autoscaler
// last wrote to the clips folder (a container can't see the others), else the
// setting. The file is checked for sense, since it arrives from outside the worker.
func recordersOnCard(file string) int {
	if b, err := os.ReadFile(file); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && n >= 1 && n <= 64 {
			return n
		}
	}
	return envPositive("AT_RECORDERS_PER_GPU", 1)
}

func statsEnabled() bool { return env("AT_TELEMETRY", "1") != "0" && !statsOffByAdmin.Load() }

func logStatsNotice() {
	if statsEnabled() {
		log.Printf("after a benchmark this recorder sends its anonymous result (GPU, CPU, versions, times) to the website; AT_TELEMETRY=0 turns it off")
	}
}

// nvidiaCard is the card this recorder uses, from nvidia-smi's CSV: the one
// CUDA_VISIBLE_DEVICES names when it names one, else the first.
type nvidiaCard struct {
	name, driver string
	totalMb      int
	usedMb       int
}

func pickNvidiaCard(csv, uuid string) (nvidiaCard, bool) {
	first, found := nvidiaCard{}, false
	for _, line := range strings.Split(strings.TrimSpace(csv), "\n") {
		f := strings.Split(line, ", ")
		if len(f) != 5 {
			continue
		}
		total, err1 := strconv.Atoi(strings.TrimSpace(f[3]))
		used, err2 := strconv.Atoi(strings.TrimSpace(f[4]))
		if err1 != nil || err2 != nil {
			continue
		}
		c := nvidiaCard{name: f[1], driver: f[2], totalMb: total, usedMb: used}
		if uuid != "" && f[0] == uuid {
			return c, true
		}
		if !found {
			first, found = c, true
		}
	}
	return first, found
}

func readNvidiaCard() (nvidiaCard, bool) {
	out, err := exec.Command("nvidia-smi", "--query-gpu=uuid,name,driver_version,memory.total,memory.used", "--format=csv,noheader,nounits").Output()
	if err != nil {
		return nvidiaCard{}, false
	}
	return pickNvidiaCard(string(out), os.Getenv("CUDA_VISIBLE_DEVICES"))
}

// watchPeakVRAM polls the card until ctx ends, and returns the peak on the
// returned channel. The whole card, which is the point when recorders share it.
func watchPeakVRAM(ctx context.Context) <-chan int {
	peak := make(chan int, 1)
	go func() {
		top := 0
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			if c, ok := readNvidiaCard(); ok && c.usedMb > top {
				top = c.usedMb
			}
			select {
			case <-ctx.Done():
				peak <- top
				return
			case <-tick.C:
			}
		}
	}()
	return peak
}

var reCPUModel = regexp.MustCompile(`^model name\s*:\s*(.+)$`)

func cpuModel() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		if m := reCPUModel.FindStringSubmatch(s.Text()); m != nil {
			return m[1]
		}
	}
	return ""
}

// statsInstallID is a random id kept in the recorder's home: it says nothing
// about the machine, and lets the site count an install once.
func statsInstallID() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "at-recorder", "stats-install-id")
	if b, err := os.ReadFile(path); err == nil && len(b) == 36 {
		return string(b), nil
	}
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	id := fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	return id, os.WriteFile(path, []byte(id), 0o644)
}

// statsFromTries is the fastest finished try, with the rest counted as failed
// when they did not finish; false when none finished.
func statsFromTries(tries []benchmarkTry) (seconds, fps float64, failed int, ok bool) {
	for _, t := range tries {
		switch {
		case !t.OK || t.Seconds == nil || t.CaptureFps == nil:
			failed++
		case !ok || *t.Seconds < seconds:
			seconds, fps, ok = *t.Seconds, *t.CaptureFps, true
		}
	}
	return seconds, fps, failed, ok
}

// sendRecorderStats reports a benchmark of the shipped clip; another clip's
// time doesn't compare. Best effort, one try: a failure only logs a line.
func (r *recorder) sendRecorderStats(ctx context.Context, tries []benchmarkTry, source string, peakMb int) {
	if !statsEnabled() || source != "bundled" {
		return
	}
	seconds, fps, failed, ok := statsFromTries(tries)
	// shortcut: NVIDIA only, since the rest report no memory; add others when someone runs them.
	card, found := readNvidiaCard()
	if !ok || !found {
		return
	}
	id, err := statsInstallID()
	if err != nil {
		log.Printf("recorder stats: %v", err)
		return
	}
	s := recorderStats{
		InstallID: id, BenchmarkVersion: benchmarkVersion, GPUModel: card.name, VRAMMb: card.totalMb,
		CPUModel: cpuModel(), Driver: card.driver, RecorderVersion: strconv.Itoa(recorderVersion),
		Resolution: fmt.Sprintf("%dx%d", r.width, r.height), RecordersPerGPU: recordersOnCard("/mnt/clips/recorders-on-card"),
		Seconds: seconds, FramesPerSecond: fps, PeakVRAMMb: peakMb, FailedTries: failed,
	}
	body, err := json.Marshal(s)
	if err != nil {
		return
	}
	log.Printf("recorder stats: sending %s", body)
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, env("AT_STATS_URL", recorderStatsURL), bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("recorder stats: %v", err)
		return
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		log.Printf("recorder stats: the website answered %d", res.StatusCode)
	}
}
