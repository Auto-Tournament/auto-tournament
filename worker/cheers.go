package main

import (
	"math"
	"sort"
	"strings"
)

// The crowd cheers only for kills worth it (sound.go): the third kill of a
// quick run, a hard shot (an AWP kill, a no-scope, through a wall or smoke,
// in the air, while flashed), a flick, or the kill that finishes an ace, a 4K or a clutch.
const (
	cheerRunTicks    = 10 * tickrate // three kills within this long make a run
	cheerGapTicks    = 5 * tickrate / 2
	cheerFlickTicks  = 24 // how far back a flick is looked for
	cheerFlickDegree = 90.0
)

// cheerTicks is which of the moment's kills (m.KillTicks, the player's) get a cheer.
func cheerTicks(rp *Replay, player string, m moment) []int {
	kills := append([]int(nil), m.KillTicks...)
	sort.Ints(kills)
	byTick := map[int]ReplayKill{}
	index := -1
	if rp != nil {
		for _, k := range rp.Kills {
			if k.Attacker != nil && *k.Attacker == player {
				byTick[k.Tick] = k
			}
		}
		for i, p := range rp.Players {
			if p.ID == player {
				index = i
			}
		}
	}
	var out []int
	last := math.MinInt / 2
	for i, t := range kills {
		k, known := byTick[t]
		cheer := i >= 2 && t-kills[i-2] <= cheerRunTicks
		if known && (k.NoScope || k.ThroughSmoke || k.InAir || k.AttackerBlind || k.Penetrated || k.Weapon == "AWP") {
			cheer = true
		}
		if known && k.Headshot && flicked(rp, index, t) {
			cheer = true
		}
		if i == len(kills)-1 && (m.Kind == "ace" || m.Kind == "4k" || strings.Contains(strings.ToLower(m.Title), "clutch")) {
			cheer = true
		}
		if cheer && t-last >= cheerGapTicks {
			out = append(out, t)
			last = t
		}
	}
	return out
}

// flicked: the player's aim swung at least cheerFlickDegree in the
// cheerFlickTicks before the kill (the replay's yaw, every FrameStep ticks).
func flicked(rp *Replay, index, tick int) bool {
	if rp == nil || index < 0 {
		return false
	}
	var yaws []float64
	for _, f := range rp.Frames {
		t, _ := f[0].(int)
		if t < tick-cheerFlickTicks-FrameStep || t > tick+FrameStep/2 {
			continue
		}
		row, _ := f[1].([]any)
		if index < len(row) {
			if v, ok := row[index].([6]float64); ok {
				yaws = append(yaws, v[2])
			}
		}
	}
	for i := 1; i < len(yaws); i++ {
		d := math.Mod(math.Abs(yaws[i]-yaws[i-1]), 360)
		if d > 180 {
			d = 360 - d
		}
		if d >= cheerFlickDegree {
			return true
		}
	}
	return false
}

// cheerTimes is where the cheered kills are in the clip: the kill markers
// (in kill order) of the ticks that get a cheer.
func cheerTimes(killTicks []int, killTimes []float64, cheers []int) []float64 {
	ticks := append([]int(nil), killTicks...)
	sort.Ints(ticks)
	if len(ticks) != len(killTimes) {
		return nil
	}
	want := map[int]bool{}
	for _, t := range cheers {
		want[t] = true
	}
	out := []float64{}
	for i, t := range ticks {
		if want[t] {
			out = append(out, killTimes[i])
		}
	}
	return out
}

// moment is one highlight to record: its ticks are the demo's own.
type moment struct {
	ID         int    `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Round      int    `json:"round"`
	Score      int    `json:"score"`
	StartTick  int    `json:"startTick"`
	EndTick    int    `json:"endTick"`
	SlowmoTick int    `json:"slowmoTick"`
	KillTicks  []int  `json:"killTicks"`
}
