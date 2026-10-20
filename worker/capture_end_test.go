//go:build linux

package main

import "testing"

func TestKillsPastEnd(t *testing.T) {
	if killsPastEnd([]int{100, 200}, 0) {
		t.Fatal("an unknown length cuts nothing")
	}
	if killsPastEnd([]int{100, 200}, 200+endMargin) {
		t.Fatal("a kill a margin before the end is reachable")
	}
	if !killsPastEnd([]int{100, 200}, 200+endMargin-1) {
		t.Fatal("a kill inside the end margin is past the end")
	}
}
