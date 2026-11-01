package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type scaleDocker struct {
	calls   []string
	idle    map[string]bool
	scaled  string
	primary string // env of the first recorder
	oom     string
}

func (f *scaleDocker) run(_ context.Context, args ...string) ([]byte, error) {
	line := strings.Join(args, " ")
	f.calls = append(f.calls, line)
	switch {
	case args[0] == "ps":
		return []byte(f.scaled), nil
	case args[0] == "inspect":
		return []byte(f.primary), nil
	case args[0] == "exec" && args[2] == "test":
		if f.idle[args[1]] {
			return nil, nil
		}
		return nil, errors.New("not idle")
	case args[0] == "exec" && args[2] == "journalctl":
		if f.oom == args[1] {
			return []byte("the encoder ran out of GPU memory for x"), nil
		}
	}
	return nil, nil
}

func (f *scaleDocker) did(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

func autoscaleFixture(t *testing.T, waiting string, used int) (*agent, *scaleDocker) {
	t.Helper()
	old := readScaleCards
	readScaleCards = func(context.Context) ([]scaleCard, error) {
		return []scaleCard{{UUID: "GPU-a", Bus: "0000:81:00.0", TotalMB: 12288, UsedMB: used}, {UUID: "GPU-other", Bus: "0000:82:00.0", TotalMB: 12288}}, nil
	}
	t.Cleanup(func() { readScaleCards = old })
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"waiting":` + waiting + `}`))
	}))
	t.Cleanup(site.Close)
	f := &scaleDocker{idle: map[string]bool{}}
	return &agent{root: t.TempDir(), name: "box", base: site.URL, token: "k", http: site.Client(), run: f.run}, f
}

func TestAutoscaleOffUnlessSwitchedOn(t *testing.T) {
	t.Setenv("AT_AUTOSCALE", "")
	if err := (&agent{}).autoscale(context.Background()); err == nil {
		t.Fatal("should refuse")
	}
	t.Setenv("AT_AUTOSCALE", "1")
	t.Setenv("AT_AUTOSCALE_GPUS", " ")
	if err := (&agent{}).autoscale(context.Background()); err == nil {
		t.Fatal("no GPUs should refuse")
	}
}

func TestAutoscaleStartsAStoppedRecorderWhenJobsWait(t *testing.T) {
	a, f := autoscaleFixture(t, "1", 100)
	f.scaled = "box-2|GPU-a|exited\n"
	if err := a.autoscaleTick(context.Background(), newAutoscaleState(), []string{"GPU-a"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !f.did("start box-2") {
		t.Fatalf("calls: %v", f.calls)
	}
}

func TestAutoscaleNotOnACardNotAllowed(t *testing.T) {
	a, f := autoscaleFixture(t, "5", 100)
	f.scaled = "box-2|GPU-other|exited\n"
	if err := a.autoscaleTick(context.Background(), newAutoscaleState(), []string{"GPU-a"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if f.did("start box-2") {
		t.Fatalf("started on a card it may not use: %v", f.calls)
	}
}

func TestAutoscaleWaitsForTheNewRecorderToSettle(t *testing.T) {
	a, f := autoscaleFixture(t, "3", 100)
	f.scaled = "box-2|GPU-a|exited\nbox-3|GPU-a|exited\n"
	st := newAutoscaleState()
	now := time.Now()
	_ = a.autoscaleTick(context.Background(), st, []string{"GPU-a"}, now)
	f.calls = nil
	_ = a.autoscaleTick(context.Background(), st, []string{"GPU-a"}, now.Add(time.Minute))
	if f.did("start ") {
		t.Fatalf("started another too soon: %v", f.calls)
	}
}

func TestAutoscaleStopsOnlyWhatItMadeAfterTheIdleWait(t *testing.T) {
	a, f := autoscaleFixture(t, "0", 100)
	f.scaled = "box-2|GPU-a|running\n"
	f.primary = "CUDA_VISIBLE_DEVICES=GPU-a\n"
	f.idle = map[string]bool{"box-2": true, "at-recorder": true}
	st := newAutoscaleState()
	now := time.Now()
	allowed := []string{"GPU-a"}
	_ = a.autoscaleTick(context.Background(), st, allowed, now)
	if f.did("stop ") {
		t.Fatalf("stopped too soon: %v", f.calls)
	}
	_ = a.autoscaleTick(context.Background(), st, allowed, now.Add(21*time.Minute))
	if !f.did("stop box-2") {
		t.Fatalf("calls: %v", f.calls)
	}
	if f.did("stop at-recorder") {
		t.Fatal("must never stop the first recorder")
	}
}

func TestAutoscaleNeverStopsARecorderAtAJob(t *testing.T) {
	a, f := autoscaleFixture(t, "0", 100)
	f.scaled = "box-2|GPU-a|running\n"
	st := newAutoscaleState()
	st.idleSince["box-2"] = time.Now().Add(-time.Hour)
	_ = a.autoscaleTick(context.Background(), st, []string{"GPU-a"}, time.Now())
	if f.did("stop ") {
		t.Fatalf("stopped a busy recorder: %v", f.calls)
	}
}

func TestAutoscaleLowersACardAfterOutOfMemory(t *testing.T) {
	a, f := autoscaleFixture(t, "5", 100)
	f.scaled = "box-2|GPU-a|running\nbox-3|GPU-a|exited\n"
	f.primary = "CUDA_VISIBLE_DEVICES=GPU-a\n"
	f.oom = "box-2"
	st := newAutoscaleState()
	_ = a.autoscaleTick(context.Background(), st, []string{"GPU-a"}, time.Now())
	if st.limits["GPU-a"] != 1 || f.did("start box-3") {
		t.Fatalf("limit %d, calls %v", st.limits["GPU-a"], f.calls)
	}
}

func TestCS2Patch(t *testing.T) {
	dir := t.TempDir()
	inf := filepath.Join(dir, "games/GameLibrary/Steam/steamapps/common/CS/game/csgo")
	if err := os.MkdirAll(inf, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inf, "steam.inf"), []byte("ClientVersion=1\nPatchVersion=1.41.9.4\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := cs2Patch(dir); got != "1.41.9.4" {
		t.Fatalf("%q", got)
	}
	if got := cs2Patch(t.TempDir()); got != "" {
		t.Fatalf("%q", got)
	}
}
