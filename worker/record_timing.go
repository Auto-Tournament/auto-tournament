package main

import (
	"errors"
	"fmt"
	"time"
)

// tickrate is CS2's ticks per second of game time.
const tickrate = 64

// span is a stretch of demo played between a resume and a pause.
type span struct {
	fromTick, toTick int
	resumed, paused  time.Time
}

// frameWindow is which captured frames show ticks [from, to], and the rate
// (frames per second of game time) they were captured at.
type frameWindow struct {
	first, last int
	rate        float64
}

// windowFor maps frame arrival times onto the demo ticks of a span (the demo
// plays at a steady rate between its resume and its pause) and picks the
// frames showing [from, to].
func windowFor(times []time.Time, s span, from, to int) (frameWindow, error) {
	if len(times) < 2 || !s.paused.After(s.resumed) {
		return frameWindow{}, errors.New("not enough frames captured")
	}
	perSecond := float64(s.toTick-s.fromTick) / s.paused.Sub(s.resumed).Seconds()
	tickAt := func(t time.Time) float64 {
		return float64(s.fromTick) + t.Sub(s.resumed).Seconds()*perSecond
	}
	w := frameWindow{first: -1, last: -1}
	for i, t := range times {
		tick := tickAt(t)
		if tick < float64(from) || t.Before(s.resumed) || t.After(s.paused) {
			continue
		}
		if tick > float64(to) {
			break
		}
		if w.first < 0 {
			w.first = i
		}
		w.last = i
	}
	if w.first < 0 || w.last <= w.first {
		return frameWindow{}, fmt.Errorf("no frames between ticks %d and %d", from, to)
	}
	gameSeconds := (tickAt(times[w.last]) - tickAt(times[w.first])) / tickrate
	w.rate = float64(w.last-w.first) / gameSeconds
	return w, nil
}
