package main

import (
	"bufio"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
)

// A seek that loads successfully but overshoots by 187 ticks, as in the
// EWC final run, must be moved back before any capture begins.
func TestCaptureSeekCorrectsOpeningOvershoot(t *testing.T) {
	conn, peer := net.Pipe()
	defer conn.Close()
	defer peer.Close()
	con := &console{conn: conn, lines: make(chan string, 16)}
	targets := make(chan int, 8)
	landed := make(chan int, 8)
	go func() {
		sc := bufio.NewScanner(peer)
		target := 0
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "demo_gototick ") {
				target, _ = strconv.Atoi(strings.TrimPrefix(line, "demo_gototick "))
				targets <- target
			}
			if line == "demo_pause" {
				tick := target + 187
				landed <- tick
				con.lines <- fmt.Sprintf("paused on tick %d", tick+1000)
			}
		}
	}()
	g := &game{con: con, startTick: 1000}
	if err := g.seekForCapture(42134, 0.67); err != nil {
		t.Fatal(err)
	}
	first, second := <-targets, <-targets
	if first != 42134 || second >= first {
		t.Fatalf("seek targets %d, %d", first, second)
	}
	<-landed
	if tick := <-landed; tick > 42134+lead/2 {
		t.Fatalf("opening still missing at tick %d", tick)
	}
	select {
	case extra := <-targets:
		t.Fatalf("unexpected extra seek %d", extra)
	default:
	}
}

func TestCaptureSeekDoesNotRetryAnEarlyLanding(t *testing.T) {
	conn, peer := net.Pipe()
	defer conn.Close()
	defer peer.Close()
	con := &console{conn: conn, lines: make(chan string, 16)}
	targets := make(chan int, 8)
	go func() {
		sc := bufio.NewScanner(peer)
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), "demo_gototick ") {
				target, _ := strconv.Atoi(strings.TrimPrefix(sc.Text(), "demo_gototick "))
				targets <- target
			}
			if sc.Text() == "demo_pause" {
				con.lines <- "paused on tick 10020"
			}
		}
	}()
	if err := (&game{con: con}).seekForCapture(10000, 0.5); err != nil {
		t.Fatal(err)
	}
	if target := <-targets; target != 10000 {
		t.Fatal(target)
	}
	select {
	case extra := <-targets:
		t.Fatalf("unnecessary seek %d", extra)
	default:
	}
}

func TestCaptureSeekRejectsOvershootAtDemoStart(t *testing.T) {
	conn, peer := net.Pipe()
	defer conn.Close()
	defer peer.Close()
	con := &console{conn: conn, lines: make(chan string, 16)}
	go func() {
		sc := bufio.NewScanner(peer)
		for sc.Scan() {
			if sc.Text() == "demo_pause" {
				con.lines <- "paused on tick 187"
			}
		}
	}()
	if err := (&game{con: con}).seekForCapture(0, 0.5); err == nil || !strings.Contains(err.Error(), "past capture run-up") {
		t.Fatalf("late landing at demo start must fail before capture: %v", err)
	}
}

// A resume whose answer goes missing while the demo plays on (csm-test,
// 2026-10-20) must seek back before resuming again, not start 190 ticks late.
func TestResumeSeeksBackAfterAMissingAnswer(t *testing.T) {
	conn, peer := net.Pipe()
	defer conn.Close()
	defer peer.Close()
	con := &console{conn: conn, lines: make(chan string, 16)}
	go func() {
		sc := bufio.NewScanner(peer)
		tick, resumes := 42630, 0
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "demo_gototick "):
				tick, _ = strconv.Atoi(strings.TrimPrefix(line, "demo_gototick "))
			case line == "demo_resume":
				resumes++
				if resumes == 1 {
					tick += 190 // played on, said nothing
				} else {
					con.lines <- fmt.Sprintf("unpaused on tick %d", tick+1000)
				}
			case line == "demo_pause":
				con.lines <- fmt.Sprintf("paused on tick %d", tick+1000)
			}
		}
	}()
	g := &game{con: con, startTick: 1000}
	v, _, err := g.resume(42630, 0.7)
	if err != nil {
		t.Fatal(err)
	}
	if tick, _ := strconv.Atoi(v); tick-1000 > 42630+lead/2 {
		t.Fatalf("resumed at tick %d, past the run-up", tick-1000)
	}
}
