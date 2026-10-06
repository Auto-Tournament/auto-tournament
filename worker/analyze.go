package main

import (
	"io"
	"math"
	"sort"
	"strconv"
	"time"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
)

// Analysis is what the platform stores for a map (worker/README.md has the contract).
type Analysis struct {
	AnalyzerVersion int                     `json:"analyzerVersion"`
	Map             string                  `json:"map"`
	LiveTick        int                     `json:"liveTick"`
	LastTick        int                     `json:"lastTick"`
	Rounds          []Round                 `json:"rounds"`
	Kills           []Kill                  `json:"kills"`
	Players         map[string]*PlayerStats `json:"players"`
}

// ReplayPlayer names a column of the replay frames.
type ReplayPlayer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ReplayKill is a kill on the replay's timeline.
type ReplayKill struct {
	Tick     int     `json:"tick"`
	Attacker *string `json:"attacker"`
	Victim   string  `json:"victim"`
	Weapon   string  `json:"weapon"`
	Headshot bool    `json:"headshot"`
}

// Replay is the 2D replay: each player's [x, y, yaw, health, side 2|3] every
// FrameStep ticks, null while not playing.
type Replay struct {
	Map      string         `json:"map"`
	Tickrate float64        `json:"tickrate"`
	Step     int            `json:"step"`
	Players  []ReplayPlayer `json:"players"`
	Frames   [][2]any       `json:"frames"`
	Rounds   []Round        `json:"rounds"`
	Kills    []ReplayKill   `json:"kills"`
}

const flashMin = 700 * time.Millisecond

// reasonName is how a round ended, in the platform's words.
func reasonName(r events.RoundEndReason) string {
	switch r {
	case events.RoundEndReasonTargetBombed:
		return "bomb_exploded"
	case events.RoundEndReasonBombDefused:
		return "bomb_defused"
	case events.RoundEndReasonCTWin:
		return "t_killed"
	case events.RoundEndReasonTerroristsWin:
		return "ct_killed"
	case events.RoundEndReasonTargetSaved:
		return "time_ran_out"
	case events.RoundEndReasonTerroristsSurrender:
		return "t_surrender"
	case events.RoundEndReasonCTSurrender:
		return "ct_surrender"
	case events.RoundEndReasonDraw:
		return "draw"
	}
	return "other"
}

func human(p *common.Player) bool { return p != nil && !p.IsBot && p.SteamID64 > 76561197960265728 }
func id(p *common.Player) string  { return strconv.FormatUint(p.SteamID64, 10) }

func sideName(t common.Team) *string {
	var s string
	switch t {
	case common.TeamCounterTerrorists:
		s = "CT"
	case common.TeamTerrorists:
		s = "T"
	default:
		return nil
	}
	return &s
}

func isGun(e *common.Equipment) bool {
	if e == nil {
		return false
	}
	switch e.Class() {
	case common.EqClassPistols, common.EqClassSMG, common.EqClassHeavy, common.EqClassRifle:
		return true
	}
	return false
}

// pitch as degrees, up negative (demos store 0..360).
func pitchOf(p *common.Player) float64 {
	v := float64(p.ViewDirectionY())
	if v > 180 {
		v -= 360
	}
	return v
}

func eyes(p *common.Player) [3]float64 {
	if v, ok := p.PositionEyes(); ok {
		return [3]float64{v.X, v.Y, v.Z}
	}
	v := p.Position()
	return [3]float64{v.X, v.Y, v.Z + 64}
}

// Analyze reads a whole demo. mapName is the platform's (the demo's header
// is not always exposed by the parser).
func Analyze(r io.Reader, mapName string) (*Analysis, *Replay, error) {
	p := dem.NewParser(r)
	defer p.Close()
	gs := p.GameState()

	var (
		liveTick  int
		live      bool
		inRound   bool
		rounds    []Round
		kills     []Kill
		players   = map[string]*PlayerStats{}
		sides     = map[int]map[string]string{} // round -> player -> side
		shots     = map[string][]Shot{}
		hitTicks  = map[string][]int{}
		spotted   = map[[2]uint64]bool{}
		spotTick  = map[[2]uint64]int{}
		equipCT   int
		equipT    int
		frames    = map[int]map[string][5]float64{}
		lastFrame = -FrameStep
	)
	stats := func(sid string) *PlayerStats {
		s, ok := players[sid]
		if !ok {
			s = &PlayerStats{Name: sid}
			players[sid] = s
		}
		return s
	}
	named := func(pl *common.Player) *PlayerStats {
		s := stats(id(pl))
		if pl.Name != "" {
			s.Name = pl.Name
		}
		return s
	}
	reset := func() {
		liveTick = gs.IngameTick()
		rounds, kills = nil, nil
		players = map[string]*PlayerStats{}
		sides = map[int]map[string]string{}
		shots, hitTicks = map[string][]Shot{}, map[string][]int{}
		frames = map[int]map[string][5]float64{}
		spotted = map[[2]uint64]bool{}
		spotTick = map[[2]uint64]int{}
	}

	// Live play: from the last match start (a restart starts it again).
	p.RegisterEventHandler(func(events.MatchStart) { reset(); live = true })
	p.RegisterEventHandler(func(events.RoundFreezetimeEnd) {
		if live && !gs.IsWarmupPeriod() {
			inRound = true
			// What each side bought this round (bots too: it is the team's economy).
			equipCT, equipT = 0, 0
			for _, pl := range gs.Participants().Playing() {
				switch pl.Team {
				case common.TeamCounterTerrorists:
					equipCT += pl.EquipmentValueFreezeTimeEnd()
				case common.TeamTerrorists:
					equipT += pl.EquipmentValueFreezeTimeEnd()
				}
			}
		}
	})
	p.RegisterEventHandler(func(e events.RoundEnd) {
		if !live || gs.IsWarmupPeriod() {
			return
		}
		inRound = false
		start := liveTick
		if len(rounds) > 0 {
			start = rounds[len(rounds)-1].EndTick
		}
		reason := reasonName(e.Reason)
		rd := Round{Number: len(rounds) + 1, StartTick: start, EndTick: gs.IngameTick(), Winner: sideName(e.Winner), Reason: &reason, CTEquipment: equipCT, TEquipment: equipT}
		rounds = append(rounds, rd)
		roster := map[string]string{}
		for _, pl := range gs.Participants().Playing() {
			side := sideName(pl.Team)
			if !human(pl) || side == nil {
				continue
			}
			roster[id(pl)] = *side
			s := named(pl)
			s.RoundsPlayed++
			if *side == "CT" {
				s.CTRounds++
				if rd.Winner != nil && *rd.Winner == "CT" {
					s.CTRoundsWon++
				}
			} else {
				s.TRounds++
				if rd.Winner != nil && *rd.Winner == "T" {
					s.TRoundsWon++
				}
			}
			if m := pl.MoneySpentTotal(); m > s.MoneySpent {
				s.MoneySpent = m
			}
		}
		sides[rd.Number] = roster
	})

	roundNow := func() int { return len(rounds) + 1 }

	p.RegisterEventHandler(func(e events.Kill) {
		if !live || gs.IsWarmupPeriod() || !human(e.Victim) {
			return
		}
		named(e.Victim)
		k := Kill{
			Tick:         gs.IngameTick(),
			Round:        roundNow(),
			Victim:       id(e.Victim),
			Headshot:     e.IsHeadshot,
			Penetrated:   e.PenetratedObjects > 0,
			ThroughSmoke: e.ThroughSmoke,
			VictimSide:   sideName(e.Victim.Team),
			VictimPos:    [2]float64{e.Victim.Position().X, e.Victim.Position().Y},
			Weapon:       "world",
		}
		if e.Weapon != nil {
			k.Weapon = e.Weapon.String()
		}
		if human(e.Killer) && e.Killer.SteamID64 != e.Victim.SteamID64 {
			a := id(e.Killer)
			k.Attacker = &a
			k.AttackerSide = sideName(e.Killer.Team)
			pos := [2]float64{e.Killer.Position().X, e.Killer.Position().Y}
			k.AttackerPos = &pos
			named(e.Killer)
		}
		if human(e.Assister) {
			as := id(e.Assister)
			k.Assister = &as
			named(e.Assister)
		}
		kills = append(kills, k)
	})

	p.RegisterEventHandler(func(e events.WeaponFire) {
		if !live || !inRound || !human(e.Shooter) || !isGun(e.Weapon) {
			return
		}
		shots[id(e.Shooter)] = append(shots[id(e.Shooter)], Shot{Tick: gs.IngameTick(), Weapon: e.Weapon.String()})
	})

	p.RegisterEventHandler(func(e events.PlayerHurt) {
		if !live || !inRound || !human(e.Attacker) || e.Player == nil || e.Attacker.SteamID64 == e.Player.SteamID64 {
			return
		}
		if e.Attacker.Team == e.Player.Team {
			return
		}
		s := named(e.Attacker)
		s.Damage += e.HealthDamageTaken
		if e.Weapon != nil && e.Weapon.Class() == common.EqClassGrenade {
			s.UtilityDamage += e.HealthDamageTaken
		} else if isGun(e.Weapon) {
			tick := gs.IngameTick()
			hitTicks[id(e.Attacker)] = append(hitTicks[id(e.Attacker)], tick)
			// Time to damage: the first hit on an enemy since spotting them.
			key := [2]uint64{e.Attacker.SteamID64, e.Player.SteamID64}
			if t0, ok := spotTick[key]; ok {
				delete(spotTick, key)
				if ms := float64(tick-t0) * 1000 / p.TickRate(); ms >= 0 && ms < 1000 {
					s.TimeToDamageSum += ms
					s.TimeToDamageSamples++
				}
			}
		}
	})

	p.RegisterEventHandler(func(e events.PlayerFlashed) {
		if !live || !inRound || !human(e.Attacker) || e.Player == nil || e.Attacker.SteamID64 == e.Player.SteamID64 {
			return
		}
		if e.FlashDuration() < flashMin {
			return
		}
		s := named(e.Attacker)
		if e.Attacker.Team == e.Player.Team {
			s.FriendliesFlashed++
		} else {
			s.EnemiesFlashed++
		}
	})

	p.RegisterEventHandler(func(events.FrameDone) {
		if !live || gs.IsWarmupPeriod() {
			return
		}
		tick := gs.IngameTick()
		playing := gs.Participants().Playing()
		if inRound {
			// Crosshair placement: when an enemy first comes into view, how
			// far the crosshair was from their head.
			for _, a := range playing {
				if !human(a) || !a.IsAlive() {
					continue
				}
				for _, e := range playing {
					if e == a || e.Team == a.Team || !e.IsAlive() {
						continue
					}
					key := [2]uint64{a.SteamID64, e.SteamID64}
					now := a.HasSpotted(e)
					if now && !spotted[key] {
						s := named(a)
						s.CrosshairAngleSum += AimError(eyes(a), pitchOf(a), float64(a.ViewDirectionX()), eyes(e))
						s.CrosshairSamples++
						spotTick[key] = tick
					}
					spotted[key] = now
				}
			}
		}
		if tick-lastFrame >= FrameStep {
			lastFrame = tick
			f := map[string][5]float64{}
			for _, pl := range playing {
				if !human(pl) || !pl.IsAlive() {
					continue
				}
				pos := pl.Position()
				f[id(pl)] = [5]float64{math.Round(pos.X), math.Round(pos.Y), math.Round(float64(pl.ViewDirectionX())), float64(pl.Health()), float64(pl.Team)}
			}
			frames[tick] = f
		}
	})

	if err := p.ParseToEnd(); err != nil && err != dem.ErrUnexpectedEndOfDemo {
		return nil, nil, err
	}

	lastTick := liveTick
	if len(rounds) > 0 {
		lastTick = rounds[len(rounds)-1].EndTick
	}
	// Kills after the last round's end (the game over screen) don't count.
	var counted []Kill
	for _, k := range kills {
		if k.Round <= len(rounds) {
			counted = append(counted, k)
		}
	}
	kills = counted
	MarkOpeningsAndTrades(kills)
	CountKills(kills, stats)
	for _, rd := range rounds {
		CountClutches(rd, sides[rd.Number], kills, stats)
		CountKast(rd, sides[rd.Number], kills, stats)
	}
	for sid, list := range shots {
		CountShots(stats(sid), list, hitTicks[sid])
	}

	ids := make([]string, 0, len(players))
	for sid := range players {
		ids = append(ids, sid)
	}
	sort.Strings(ids)
	replay := &Replay{Map: mapName, Tickrate: p.TickRate(), Step: FrameStep, Rounds: rounds}
	for _, sid := range ids {
		replay.Players = append(replay.Players, ReplayPlayer{ID: sid, Name: players[sid].Name})
	}
	ticks := make([]int, 0, len(frames))
	for t := range frames {
		if t >= liveTick && t <= lastTick {
			ticks = append(ticks, t)
		}
	}
	sort.Ints(ticks)
	for _, t := range ticks {
		row := make([]any, len(ids))
		for i, sid := range ids {
			if v, ok := frames[t][sid]; ok {
				row[i] = v
			}
		}
		replay.Frames = append(replay.Frames, [2]any{t, row})
	}
	for _, k := range kills {
		replay.Kills = append(replay.Kills, ReplayKill{Tick: k.Tick, Attacker: k.Attacker, Victim: k.Victim, Weapon: k.Weapon, Headshot: k.Headshot})
	}
	if rounds == nil {
		rounds = []Round{}
	}
	if kills == nil {
		kills = []Kill{}
	}
	return &Analysis{
		AnalyzerVersion: AnalyzerVersion,
		Map:             mapName,
		LiveTick:        liveTick,
		LastTick:        lastTick,
		Rounds:          rounds,
		Kills:           kills,
		Players:         players,
	}, replay, nil
}
