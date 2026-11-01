package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestRecorderStatsSendsOnlyTheListedFields(t *testing.T) {
	b, err := json.Marshal(recorderStats{})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(m))
	for k := range m {
		got = append(got, k)
	}
	sort.Strings(got)
	// The website's parse.ts and privacy policy list these: change all three together.
	want := []string{"benchmarkVersion", "cpuModel", "driver", "failedTries", "framesPerSecond", "gpuModel", "installId", "peakVramMb", "recorderVersion", "recordersPerGpu", "resolution", "seconds", "vramMb"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fields:\n%v", got)
	}
}

func TestPickNvidiaCard(t *testing.T) {
	csv := "GPU-a, RTX 3060, 595.84, 12288, 900\nGPU-b, RTX 3060 Ti, 595.84, 8192, 300\n"
	if c, ok := pickNvidiaCard(csv, "GPU-b"); !ok || c.name != "RTX 3060 Ti" || c.totalMb != 8192 || c.usedMb != 300 {
		t.Fatalf("named: %+v %v", c, ok)
	}
	if c, ok := pickNvidiaCard(csv, ""); !ok || c.name != "RTX 3060" {
		t.Fatalf("first: %+v %v", c, ok)
	}
	if _, ok := pickNvidiaCard("nonsense", ""); ok {
		t.Fatal("nonsense should find none")
	}
}

func TestStatsFromTriesTakesTheFastestAndCountsFailures(t *testing.T) {
	s1, s2, f := 300.0, 280.0, 30.0
	sec, fps, failed, ok := statsFromTries([]benchmarkTry{{OK: true, Seconds: &s1, CaptureFps: &f}, {OK: false}, {OK: true, Seconds: &s2, CaptureFps: &f}})
	if !ok || sec != 280 || fps != 30 || failed != 1 {
		t.Fatalf("%v %v %v %v", sec, fps, failed, ok)
	}
	if _, _, failed, ok := statsFromTries([]benchmarkTry{{OK: false}}); ok || failed != 1 {
		t.Fatal("no finished try")
	}
}

func TestStatsInstallIDIsAStableUUID(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	a, err := statsInstallID()
	if err != nil || len(a) != 36 {
		t.Fatalf("%q %v", a, err)
	}
	if b, _ := statsInstallID(); b != a {
		t.Fatalf("changed: %q %q", a, b)
	}
}

// A fake nvidia-smi and website: what is sent, and when nothing is.
func statsFixture(t *testing.T) (*recorder, []benchmarkTry, *[]recorderStats) {
	t.Helper()
	bin := t.TempDir()
	script := "#!/bin/sh\necho 'GPU-a, RTX 3060, 595.84, 12288, 900'\n"
	if err := os.WriteFile(filepath.Join(bin, "nvidia-smi"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("CUDA_VISIBLE_DEVICES", "")
	got := &[]recorderStats{}
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		b, _ := io.ReadAll(req.Body)
		var s recorderStats
		if err := json.Unmarshal(b, &s); err != nil {
			t.Error(err)
		}
		*got = append(*got, s)
	}))
	t.Cleanup(site.Close)
	t.Setenv("AT_STATS_URL", site.URL)
	sec, fps := 282.0, 30.0
	return &recorder{width: 1920, height: 1080}, []benchmarkTry{{OK: true, Seconds: &sec, CaptureFps: &fps}}, got
}

func TestSendRecorderStats(t *testing.T) {
	r, tries, got := statsFixture(t)
	t.Setenv("AT_RECORDERS_PER_GPU", "2")
	r.sendRecorderStats(context.Background(), tries, "bundled", 6885)
	if len(*got) != 1 {
		t.Fatalf("sent %d", len(*got))
	}
	s := (*got)[0]
	if s.GPUModel != "RTX 3060" || s.VRAMMb != 12288 || s.PeakVRAMMb != 6885 || s.Seconds != 282 || s.Resolution != "1920x1080" || s.RecordersPerGPU != 2 || len(s.InstallID) != 36 {
		t.Fatalf("%+v", s)
	}
}

func TestRecorderStatsNotSent(t *testing.T) {
	r, tries, got := statsFixture(t)
	r.sendRecorderStats(context.Background(), tries, "match", 1) // not the shared clip
	applySettings(&recorderSettings{StatsOff: true})
	r.sendRecorderStats(context.Background(), tries, "bundled", 1) // the admin's setting
	applySettings(&recorderSettings{})
	t.Setenv("AT_TELEMETRY", "0")
	r.sendRecorderStats(context.Background(), tries, "bundled", 1)
	if len(*got) != 0 {
		t.Fatalf("sent %+v", *got)
	}
}

func TestRecorderStatsUnreachableSiteOnlyLogs(t *testing.T) {
	r, tries, _ := statsFixture(t)
	t.Setenv("AT_STATS_URL", "http://127.0.0.1:1")
	r.sendRecorderStats(context.Background(), tries, "bundled", 1)
}
