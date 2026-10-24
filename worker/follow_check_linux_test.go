package main

import (
	"bufio"
	"net"
	"testing"
)

// fakeGetpos answers every getpos with `setpos <pos>`, as CS2's console does.
func fakeGetpos(t *testing.T, pos string) (*game, func()) {
	t.Helper()
	conn, peer := net.Pipe()
	con := &console{conn: conn, lines: make(chan string, 16)}
	go func() {
		sc := bufio.NewScanner(peer)
		for sc.Scan() {
			if sc.Text() == "getpos" {
				con.lines <- "setpos " + pos + ";setang 0 0 0"
			}
		}
	}()
	g := &game{con: con, follow: func(int) ([3]float64, bool) { return [3]float64{926, -412, -344}, true }}
	return g, func() { conn.Close(); peer.Close() }
}

// CS2 1.41.9 answered getpos with 0 0 0 for every in-eye view: that is "no
// position", not a camera under the map, so the clip goes on.
func TestCheckFollowTreatsOriginAsUnknown(t *testing.T) {
	g, done := fakeGetpos(t, "0.000000 0.000000 0.000000")
	defer done()
	if err := g.checkFollow("Simpert", 100); err != nil {
		t.Fatalf("getpos 0 0 0 failed the clip: %v", err)
	}
}

// A real position near the player passes; one far away still fails.
func TestCheckFollowComparesRealPositions(t *testing.T) {
	g, done := fakeGetpos(t, "930.0 -410.0 -340.0")
	defer done()
	if err := g.checkFollow("Simpert", 100); err != nil {
		t.Fatalf("near the player: %v", err)
	}
	far, done2 := fakeGetpos(t, "-2000.0 1500.0 64.0")
	defer done2()
	if err := far.checkFollow("Simpert", 100); err != errNotFollowing {
		t.Fatalf("far from the player = %v, want errNotFollowing", err)
	}
}

// Spectating plays the demo on: the camera is compared with the player where
// the demo stands, not where they were at the clip's start.
func TestCheckFollowUsesTheTickTheDemoIsOn(t *testing.T) {
	conn, peer := net.Pipe()
	defer conn.Close()
	defer peer.Close()
	con := &console{conn: conn, lines: make(chan string, 16)}
	go func() {
		sc := bufio.NewScanner(peer)
		for sc.Scan() {
			switch sc.Text() {
			case "demo_pause":
				con.lines <- "Demo playback paused on tick 1148"
			case "getpos":
				con.lines <- "setpos -1012.0 -733.0 99.0;setang 0 0 0"
			}
		}
	}()
	g := &game{con: con, startTick: 1000, follow: func(tick int) ([3]float64, bool) {
		if tick == 148 {
			return [3]float64{-1010, -730, 95}, true // where the player ran to
		}
		return [3]float64{-1193, -972, 38}, true // where they were at `from`
	}}
	if err := g.checkFollow("dem0n", 100); err != nil {
		t.Fatalf("camera on the player at the demo's tick: %v", err)
	}
}

// A demo that is already paused answers nothing to demo_pause: pausedTick plays
// a frame and pauses again, and reports that tick, not an older one.
func TestPausedTickWhenAlreadyPaused(t *testing.T) {
	conn, peer := net.Pipe()
	defer conn.Close()
	defer peer.Close()
	con := &console{conn: conn, lines: make(chan string, 16)}
	go func() {
		sc := bufio.NewScanner(peer)
		playing := false
		for sc.Scan() {
			switch sc.Text() {
			case "demo_resume":
				playing = true
			case "demo_pause":
				if playing {
					con.lines <- "Demo playback paused on tick 1049"
				}
				playing = false
			}
		}
	}()
	g := &game{con: con, startTick: 1000}
	if at, ok := g.pausedTick(); !ok || at != 49 {
		t.Fatalf("pausedTick = %d, %v; want 49, true", at, ok)
	}
}
