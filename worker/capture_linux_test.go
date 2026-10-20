//go:build linux

package main

import "testing"

func TestConsoleDrainReturnsAfterGameExit(t *testing.T) {
	c := &console{lines: make(chan string, 2)}
	c.lines <- "old output"
	close(c.lines)
	c.drain()
}
