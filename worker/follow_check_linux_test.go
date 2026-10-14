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
