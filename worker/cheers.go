package main

import (
	"math"
	"sort"
	"strings"
)

// The crowd reacts to kills worth it (sound.go): a short "heeey" for a hard
// shot (an AWP kill, a no-scope, through a wall or smoke, the killer or the
// victim in the air, while flashed, a snap shot at someone in view for a split
// second, a flick), and a roar for the kills that decide something (the one
// that ends the round, the last of an ace, a 4K or a clutch, the third of a
// quick run).
const (
	cheerRunTicks    = 10 * tickrate // three kills within this long make a run
	cheerGapTicks    = 5 * tickrate / 2
	cheerFlickTicks  = 24 // how far back a flick is looked for
	cheerFlickDegree = 90.0
	cheerSnapSec     = 0.3 // in view for less than this: a snap shot
)

// cheer is one reaction: at the kill's tick, a roar or a "heeey".
type cheer struct {
	tick int
	roar bool
}

// cheerTicks is which of the moment's kills (m.KillTicks, the player's) the
// crowd reacts to, and how.
func cheerTicks(rp *Replay, player string, m moment) []cheer {
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
	var out []cheer
	for i, t := range kills {
		k, known := byTick[t]
		roar := i >= 2 && t-kills[i-2] <= cheerRunTicks
		if known && k.RoundEnding {
			roar = true
		}
		if i == len(kills)-1 && (m.Kind == "ace" || m.Kind == "4k" || strings.Contains(strings.ToLower(m.Title), "clutch")) {
			roar = true
		}
		hey := known && (k.Weapon == "AWP" || k.NoScope || k.Penetrated || k.ThroughSmoke || k.InAir || k.VictimInAir ||
			k.AttackerBlind || (k.SeenFor >= 0 && k.SeenFor < cheerSnapSec && !k.Penetrated && !k.ThroughSmoke) ||
			(k.Headshot && flicked(rp, index, t)))
		if !roar && !hey {
			continue
		}
		c := cheer{tick: t, roar: roar}
		if n := len(out); n > 0 && t-out[n-1].tick < cheerGapTicks {
			// Too close to the last reaction: keep the bigger one.
			if roar && !out[n-1].roar {
				out[n-1] = c
			}
			continue
		}
		out = append(out, c)
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

// cheerTimes is where the reactions are in the clip: the kill markers (in
// kill order) of the cheered ticks, the roars apart.
func cheerTimes(killTicks []int, killTimes []float64, cheers []cheer) (heys, roars []float64) {
	ticks := append([]int(nil), killTicks...)
	sort.Ints(ticks)
	if len(ticks) != len(killTimes) {
		return nil, nil
	}
	at := map[int]float64{}
	for i, t := range ticks {
		at[t] = killTimes[i]
	}
	heys, roars = []float64{}, []float64{}
	for _, c := range cheers {
		v, ok := at[c.tick]
		if !ok {
			continue
		}
		if c.roar {
			roars = append(roars, v)
		} else {
			heys = append(heys, v)
		}
	}
	return heys, roars
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
