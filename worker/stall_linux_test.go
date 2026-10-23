package main

import (
	"context"
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
