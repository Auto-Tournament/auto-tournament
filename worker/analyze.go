package main

import (
	"fmt"
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
	// Where the victim fell, [x, y].
	Pos [2]float64 `json:"pos"`
	// For the kill feed, as CS2 shows it.
	Assister      *string `json:"assister,omitempty"`
	AssistedFlash bool    `json:"assistedFlash,omitempty"`
	Penetrated    bool    `json:"penetrated,omitempty"`
	ThroughSmoke  bool    `json:"throughSmoke,omitempty"`
	NoScope       bool    `json:"noScope,omitempty"`
	AttackerBlind bool    `json:"attackerBlind,omitempty"`
	InAir         bool    `json:"inAir,omitempty"`
}

// Replay is the 2D replay: each player's [x, y, yaw, health, side 2|3, z] every
// FrameStep ticks, null while not playing.
type Replay struct {
	Map      string         `json:"map"`
	Tickrate float64        `json:"tickrate"`
	Step     int            `json:"step"`
	Players  []ReplayPlayer `json:"players"`
	Frames   [][2]any       `json:"frames"`
	Rounds   []Round        `json:"rounds"`
	Kills    []ReplayKill   `json:"kills"`
	// Shots: [tick, player index, x, y, yaw, hit x, hit y]; the hit is null
	// for a miss (the tracer then runs along the aim).
	Shots [][7]any `json:"shots"`
	// Grenades in flight: their path from the throw to where they went off.
	Grenades []ReplayGrenade `json:"grenades"`
	// What grenades did where: smoke and fire areas while they last, and the
	// moment a flash, HE or decoy went off.
	Effects []ReplayEffect `json:"effects"`
	// Blinds: [player index, from tick, to tick].
	Blinds [][3]int `json:"blinds"`
	// The bomb: planted, defused, exploded.
	Bomb []ReplayBomb `json:"bomb"`
	// Damage taken: [tick, player index, health lost, 1 for a headshot].
	Damage [][4]int `json:"damage"`
}

type rawDamage struct {
	tick, amount int
	victim       string
	headshot     bool
}

// ReplayGrenade is one thrown grenade's flight.
type ReplayGrenade struct {
	Type    string       `json:"type"` // smoke, flash, he, molotov, decoy
	Thrower int          `json:"thrower"`
	Path    [][3]float64 `json:"path"` // [tick, x, y]
}

// ReplayEffect is a grenade going off.
type ReplayEffect struct {
	Type  string  `json:"type"` // smoke, fire, flash, he, decoy
	Start int     `json:"start"`
	End   int     `json:"end"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

// ReplayBomb is something that happened to the bomb.
type ReplayBomb struct {
	Tick int     `json:"tick"`
	Kind string  `json:"kind"` // planted, defused, exploded
	Site string  `json:"site"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

type rawGrenade struct {
	kind    string
	thrower string
	path    [][3]float64
}

type rawBlind struct {
	player     string
	start, end int
}

func grenadeKind(t common.EquipmentType) string {
	switch t {
	case common.EqSmoke:
		return "smoke"
	case common.EqFlash:
		return "flash"
	case common.EqHE:
		return "he"
	case common.EqMolotov, common.EqIncendiary:
		return "molotov"
	case common.EqDecoy:
		return "decoy"
	}
	return "other"
}

type rawShot struct {
	tick    int
	shooter string
	x, y    float64
	yaw     float64
}

type rawHit struct {
	tick     int
	attacker string
	x, y     float64
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
		rawShots  []rawShot
		rawHits   []rawHit
		grenades  []rawGrenade
		effects   []ReplayEffect
		openFx    = map[int]int{} // grenade entity -> index in effects, for smokes and fires
		seenFx    = map[string]bool{}
		blinds    []rawBlind
		damage    []rawDamage
		killFlags []ReplayKill // per kill, in kills' order: the feed's markers
		bomb      []ReplayBomb
		equipCT   int
		equipT    int
		frames    = map[int]map[string][6]float64{}
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
		frames = map[int]map[string][6]float64{}
		spotted = map[[2]uint64]bool{}
		spotTick = map[[2]uint64]int{}
		rawShots, rawHits = nil, nil
		grenades, effects, blinds, bomb, damage, killFlags = nil, nil, nil, nil, nil, nil
		openFx = map[int]int{}
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
		killFlags = append(killFlags, ReplayKill{AssistedFlash: e.AssistedFlash, NoScope: e.NoScope, AttackerBlind: e.AttackerBlind, InAir: e.Killer != nil && e.Killer.IsAirborne()})
	})

	p.RegisterEventHandler(func(e events.WeaponFire) {
		if !live || !inRound || !human(e.Shooter) || !isGun(e.Weapon) {
			return
		}
		shots[id(e.Shooter)] = append(shots[id(e.Shooter)], Shot{Tick: gs.IngameTick(), Weapon: e.Weapon.String()})
		pos := e.Shooter.Position()
		rawShots = append(rawShots, rawShot{gs.IngameTick(), id(e.Shooter), pos.X, pos.Y, float64(e.Shooter.ViewDirectionX())})
	})

	// Every hit taken, for the replay's damage numbers (any attacker, the world too).
	p.RegisterEventHandler(func(e events.PlayerHurt) {
		if live && inRound && human(e.Player) && e.HealthDamageTaken > 0 {
			damage = append(damage, rawDamage{tick: gs.IngameTick(), amount: e.HealthDamageTaken, victim: id(e.Player), headshot: e.HitGroup == events.HitGroupHead})
		}
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
			vp := e.Player.Position()
			rawHits = append(rawHits, rawHit{tick, id(e.Attacker), vp.X, vp.Y})
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

	// Grenades: each flight, and what it did where.
	p.RegisterEventHandler(func(e events.GrenadeProjectileDestroy) {
		if !live || e.Projectile == nil || !human(e.Projectile.Thrower) || e.Projectile.WeaponInstance == nil {
			return
		}
		g := rawGrenade{kind: grenadeKind(e.Projectile.WeaponInstance.Type), thrower: id(e.Projectile.Thrower)}
		last := -100
		for i, pt := range e.Projectile.Trajectory {
			// Every fourth tick is smooth enough on a radar, plus the last point.
			if pt.Tick-last >= 4 || i == len(e.Projectile.Trajectory)-1 {
				g.path = append(g.path, [3]float64{float64(pt.Tick), math.Round(pt.Position.X), math.Round(pt.Position.Y)})
				last = pt.Tick
			}
		}
		if len(g.path) > 1 {
			grenades = append(grenades, g)
		}
	})
	effect := func(kind string, e events.GrenadeEvent, lasts int) {
		if !live {
			return
		}
		tick := gs.IngameTick()
		// The same grenade can report going off twice; once is enough.
		key := fmt.Sprintf("%s:%d:%d", kind, e.GrenadeEntityID, tick)
		if seenFx[key] {
			return
		}
		seenFx[key] = true
		effects = append(effects, ReplayEffect{Type: kind, Start: tick, End: tick + lasts, X: math.Round(e.Position.X), Y: math.Round(e.Position.Y)})
		if kind == "smoke" || kind == "fire" {
			openFx[e.GrenadeEntityID] = len(effects) - 1
		}
	}
	closeFx := func(e events.GrenadeEvent) {
		if i, ok := openFx[e.GrenadeEntityID]; ok {
			effects[i].End = gs.IngameTick()
			delete(openFx, e.GrenadeEntityID)
		}
	}
	tickrate := func() int {
		if r := p.TickRate(); r > 0 {
			return int(r)
		}
		return 64
	}
	p.RegisterEventHandler(func(e events.SmokeStart) { effect("smoke", e.GrenadeEvent, 22*tickrate()) })
	p.RegisterEventHandler(func(e events.SmokeExpired) { closeFx(e.GrenadeEvent) })
	p.RegisterEventHandler(func(e events.FireGrenadeStart) { effect("fire", e.GrenadeEvent, 7*tickrate()) })
	p.RegisterEventHandler(func(e events.FireGrenadeExpired) { closeFx(e.GrenadeEvent) })
	p.RegisterEventHandler(func(e events.FlashExplode) { effect("flash", e.GrenadeEvent, tickrate()/2) })
	p.RegisterEventHandler(func(e events.HeExplode) { effect("he", e.GrenadeEvent, tickrate()/2) })
	p.RegisterEventHandler(func(e events.DecoyStart) { effect("decoy", e.GrenadeEvent, tickrate()) })

	// Who was blind, and until when.
	p.RegisterEventHandler(func(e events.PlayerFlashed) {
		if !live || !human(e.Player) {
			return
		}
		d := e.Player.FlashDurationTimeRemaining()
		if d <= 0 {
			d = e.FlashDuration()
		}
		if d <= 0 {
			return
		}
		tick := gs.IngameTick()
		blinds = append(blinds, rawBlind{player: id(e.Player), start: tick, end: tick + int(d.Seconds()*float64(tickrate()))})
	})

	// The bomb.
	bombEvent := func(kind string, e events.BombEvent) {
		if !live {
			return
		}
		pos := gs.Bomb().Position()
		if e.Player != nil && kind == "planted" {
			pos = e.Player.Position()
		}
		site := string(rune(e.Site))
		if e.Site == 0 {
			site = ""
		}
		bomb = append(bomb, ReplayBomb{Tick: gs.IngameTick(), Kind: kind, Site: site, X: math.Round(pos.X), Y: math.Round(pos.Y)})
	}
	p.RegisterEventHandler(func(e events.BombPlanted) { bombEvent("planted", e.BombEvent) })
	p.RegisterEventHandler(func(e events.BombDefused) { bombEvent("defused", e.BombEvent) })
	p.RegisterEventHandler(func(e events.BombExplode) { bombEvent("exploded", e.BombEvent) })

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
			f := map[string][6]float64{}
			for _, pl := range playing {
				if !human(pl) || !pl.IsAlive() {
					continue
				}
				pos := pl.Position()
				f[id(pl)] = [6]float64{math.Round(pos.X), math.Round(pos.Y), math.Round(float64(pl.ViewDirectionX())), float64(pl.Health()), float64(pl.Team), math.Round(pos.Z)}
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
	var countedFlags []ReplayKill
	for i, k := range kills {
		if k.Round <= len(rounds) {
			counted = append(counted, k)
			if i < len(killFlags) {
				countedFlags = append(countedFlags, killFlags[i])
			}
		}
	}
	kills, killFlags = counted, countedFlags
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
	index := map[string]int{}
	for i, sid := range ids {
		index[sid] = i
	}
	// Each shot, ending where it hit when a hit by the same player came
	// within a few ticks.
	hitsBy := map[string][]rawHit{}
	for _, h := range rawHits {
		hitsBy[h.attacker] = append(hitsBy[h.attacker], h)
	}
	for _, sh := range rawShots {
		i, ok := index[sh.shooter]
		if !ok || sh.tick < liveTick || sh.tick > lastTick {
			continue
		}
		var hx, hy any
		for _, h := range hitsBy[sh.shooter] {
			if h.tick >= sh.tick && h.tick-sh.tick <= hitWindowTicks {
				hx, hy = math.Round(h.x), math.Round(h.y)
				break
			}
		}
		replay.Shots = append(replay.Shots, [7]any{sh.tick, i, math.Round(sh.x), math.Round(sh.y), math.Round(sh.yaw), hx, hy})
	}
	for _, g := range grenades {
		if i, ok := index[g.thrower]; ok && int(g.path[0][0]) >= liveTick && int(g.path[0][0]) <= lastTick {
			replay.Grenades = append(replay.Grenades, ReplayGrenade{Type: g.kind, Thrower: i, Path: g.path})
		}
	}
	for _, fx := range effects {
		if fx.Start >= liveTick && fx.Start <= lastTick {
			replay.Effects = append(replay.Effects, fx)
		}
	}
	for _, b := range blinds {
		if i, ok := index[b.player]; ok && b.start >= liveTick && b.start <= lastTick {
			replay.Blinds = append(replay.Blinds, [3]int{i, b.start, b.end})
		}
	}
	for _, d := range damage {
		if i, ok := index[d.victim]; ok && d.tick >= liveTick && d.tick <= lastTick {
			hs := 0
			if d.headshot {
				hs = 1
			}
			replay.Damage = append(replay.Damage, [4]int{d.tick, i, d.amount, hs})
		}
	}
	for _, b := range bomb {
		if b.Tick >= liveTick && b.Tick <= lastTick {
			replay.Bomb = append(replay.Bomb, b)
		}
	}
	for i, k := range kills {
		rk := ReplayKill{Tick: k.Tick, Attacker: k.Attacker, Victim: k.Victim, Weapon: k.Weapon, Headshot: k.Headshot, Pos: k.VictimPos,
			Assister: k.Assister, Penetrated: k.Penetrated, ThroughSmoke: k.ThroughSmoke}
		if i < len(killFlags) {
			f := killFlags[i]
			rk.AssistedFlash, rk.NoScope, rk.AttackerBlind, rk.InAir = f.AssistedFlash, f.NoScope, f.AttackerBlind, f.InAir
		}
		replay.Kills = append(replay.Kills, rk)
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
