package main

import (
	"math"
	"sort"
	"strings"
)

// The crowd reacts to kills by how impressive they are: each kill scores
// for what happened (impress), and the score picks the reaction
// (sound.go): from reactHey a short "heeey", from reactCheer a cheer, from
// reactWow a big "whoaaa".
const (
	cheerRunTicks    = 10 * tickrate // kills this close together make a run
	cheerGapTicks    = 5 * tickrate / 4
	cheerFlickTicks  = 24 // how far back a flick is looked for
	cheerFlickDegree = 90.0
	cheerSnapSec     = 0.3 // in view for less than this: a snap shot

	reactHey   = 1.0
	reactCheer = 2.5
	reactWow   = 4.0
)

// cheer is one reaction: at the kill's tick, how impressive it was.
type cheer struct {
	tick  int
	score float64
}

// impress scores one kill: what made it hard or what it decided. The parts add up.
func impress(k ReplayKill, known bool, flick bool, runLen int, last bool, m moment) float64 {
	score := 0.0
	if known {
		if k.ThroughSmoke {
			score += 3
		}
		if k.NoScope {
			score += 3
		}
		if k.InAir {
			score += 2.5
		}
		if k.AttackerBlind {
			score += 2
		}
		if k.Penetrated {
			score += 2
		}
		if k.VictimInAir {
			score += 1.5
		}
		if k.SeenFor >= 0 && k.SeenFor < cheerSnapSec && !k.Penetrated && !k.ThroughSmoke {
			score += 1.5
		}
		if flick {
			score += 1.5
		}
		if k.Weapon == "AWP" {
			score += 1
		}
		if k.Headshot {
			score += 0.5
		}
		if k.RoundEnding {
			score += 2
		}
	}
	switch {
	case runLen >= 4:
		score += 3
	case runLen == 3:
		score += 2
	}
	if last && (m.Kind == "ace" || m.Kind == "4k" || strings.Contains(strings.ToLower(m.Title), "clutch")) {
		score += 3
	}
	return score
}

// cheerTicks is which of the moment's kills (m.KillTicks, the player's) the
// crowd reacts to, with their scores.
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
		run := 1
		for j := i - 1; j >= 0 && t-kills[j] <= cheerRunTicks; j-- {
			run++
		}
		score := impress(k, known, known && k.Headshot && flicked(rp, index, t), run, i == len(kills)-1, m)
		if score < reactHey {
			continue
		}
		c := cheer{tick: t, score: score}
		if n := len(out); n > 0 && t-out[n-1].tick < cheerGapTicks {
			// Right after the last reaction: one reaction, the bigger.
			if score > out[n-1].score {
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

// reaction is a crowd reaction in a clip: seconds in, and the kill's score.
type reaction struct {
	T     float64 `json:"t"`
	Score float64 `json:"score"`
}

// cheerTimes is where the reactions are in the clip: the kill markers (in
// kill order) of the cheered ticks.
func cheerTimes(killTicks []int, killTimes []float64, cheers []cheer) []reaction {
	ticks := append([]int(nil), killTicks...)
	sort.Ints(ticks)
	if len(ticks) != len(killTimes) {
		return nil
	}
	at := map[int]float64{}
	for i, t := range ticks {
		at[t] = killTimes[i]
	}
	out := []reaction{}
	for _, c := range cheers {
		if v, ok := at[c.tick]; ok {
			out = append(out, reaction{T: v, Score: c.score})
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
