package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStallWatchStopsAStuckJobOnly(t *testing.T) {
	jobStall, stallTick = 80*time.Millisecond, 10*time.Millisecond
	defer func() { jobStall, stallTick = 30*time.Minute, time.Minute }()

	r := &recorder{}
	r.moved.Store(time.Now().UnixMilli())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.stallWatch(ctx, cancel)
	// moving: reports keep it alive past jobStall
	for i := 0; i < 10; i++ {
		time.Sleep(20 * time.Millisecond)
		r.reportAt(0)
	}
	if ctx.Err() != nil {
		t.Fatal("stopped a job that was moving")
	}
	// stuck: nothing reported
	select {
	case <-ctx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("did not stop a stuck job")
	}
}

// A file growing counts as progress for the stall watch.
func TestWhileGrowingIsProgress(t *testing.T) {
	defer func(d time.Duration) { growTick = d }(growTick)
	growTick = 20 * time.Millisecond
	r := &recorder{}
	r.moved.Store(0)
	path := filepath.Join(t.TempDir(), "out.mp4")
	stop := r.whileGrowing(path)
	defer stop()
	if err := os.WriteFile(path, []byte("frames"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if r.moved.Load() == 0 {
		t.Fatal("a growing file did not count as progress")
	}
}
