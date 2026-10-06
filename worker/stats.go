package main

import "math"

// AnalyzerVersion goes up when the numbers change meaning; the platform
// re-queues older analyses.
const AnalyzerVersion = 2

const (
	// TradeTicks: the killer dies to the victim's team within five seconds.
	TradeTicks = 5 * 64
	// sprayGapTicks: shots from one gun this close together are one spray.
	sprayGapTicks = 16
	// sprayFromBullet: from this bullet of a spray on (0-based), a hit counts as spray control.
	sprayFromBullet = 3
	// hitWindowTicks: a hit belongs to the latest shot up to this many ticks before it.
	hitWindowTicks = 4
	// FrameStep: one 2D replay frame every 16 ticks (4 per second at 64 tick).
	FrameStep = 16
)

// Round is one played round. Number is 1-based.
type Round struct {
	Number    int     `json:"number"`
	StartTick int     `json:"startTick"`
	EndTick   int     `json:"endTick"`
	Winner    *string `json:"winner"`
	Reason    *string `json:"reason"`
	// Each side's equipment value when the freeze time ended (its buy).
	CTEquipment int `json:"ctEquipment"`
	TEquipment  int `json:"tEquipment"`
}

// Kill is one death, with who traded it.
type Kill struct {
	Tick         int         `json:"tick"`
	Round        int         `json:"round"`
	Attacker     *string     `json:"attacker"`
	Victim       string      `json:"victim"`
	Assister     *string     `json:"assister"`
	Weapon       string      `json:"weapon"`
	Headshot     bool        `json:"headshot"`
	Penetrated   bool        `json:"penetrated"`
	ThroughSmoke bool        `json:"throughSmoke"`
	AttackerSide *string     `json:"attackerSide"`
	VictimSide   *string     `json:"victimSide"`
	AttackerPos  *[2]float64 `json:"attackerPos"`
	VictimPos    [2]float64  `json:"victimPos"`
	// Opening: the round's first kill.
	Opening bool `json:"opening"`
	// Trade: this kill avenged a teammate who died in the last five seconds.
	Trade bool `json:"trade"`
	// Traded: the victim was avenged within five seconds.
	Traded bool `json:"traded"`
}

// PlayerStats are one player's numbers on the map.
type PlayerStats struct {
	Name              string  `json:"name"`
	RoundsPlayed      int     `json:"roundsPlayed"`
	Kills             int     `json:"kills"`
	Deaths            int     `json:"deaths"`
	Assists           int     `json:"assists"`
	Damage            int     `json:"damage"`
	HeadshotKills     int     `json:"headshotKills"`
	OpeningKills      int     `json:"openingKills"`
	OpeningDeaths     int     `json:"openingDeaths"`
	TradeKills        int     `json:"tradeKills"`
	TradedDeaths      int     `json:"tradedDeaths"`
	ClutchesPlayed    int     `json:"clutchesPlayed"`
	ClutchesWon       int     `json:"clutchesWon"`
	MultiKills        [5]int  `json:"multiKills"` // rounds with 1..5 kills
	CTRounds          int     `json:"ctRounds"`
	CTRoundsWon       int     `json:"ctRoundsWon"`
	TRounds           int     `json:"tRounds"`
	TRoundsWon        int     `json:"tRoundsWon"`
	MoneySpent        int     `json:"moneySpent"`
	Shots             int     `json:"shots"`
	Hits              int     `json:"hits"`
	SprayShots        int     `json:"sprayShots"`
	SprayHits         int     `json:"sprayHits"`
	CrosshairAngleSum float64 `json:"crosshairAngleSum"` // degrees off the head when the enemy came into view, summed
	CrosshairSamples  int     `json:"crosshairSamples"`
	EnemiesFlashed    int     `json:"enemiesFlashed"`
	FriendliesFlashed int     `json:"friendliesFlashed"`
	UtilityDamage     int     `json:"utilityDamage"`
	// KastRounds: rounds with a kill, an assist, survival or a traded death.
	KastRounds int `json:"kastRounds"`
	// Time to damage: from first seeing an enemy to first hurting them, in
	// ms, for spots answered within a second.
	TimeToDamageSum     float64 `json:"timeToDamageSum"`
	TimeToDamageSamples int     `json:"timeToDamageSamples"`
}

// Shot is one bullet fired from a gun.
type Shot struct {
	Tick   int
	Weapon string
}

// AimError is the angle in degrees between where (pitch, yaw) looks from eye
// and the point target. Source angles: pitch down is positive.
func AimError(eye [3]float64, pitch, yaw float64, target [3]float64) float64 {
	dx, dy, dz := target[0]-eye[0], target[1]-eye[1], target[2]-eye[2]
	l := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if l == 0 {
		return 0
	}
	p := pitch * math.Pi / 180
	y := yaw * math.Pi / 180
	vx, vy, vz := math.Cos(p)*math.Cos(y), math.Cos(p)*math.Sin(y), -math.Sin(p)
	dot := (vx*dx + vy*dy + vz*dz) / l
	return math.Acos(math.Max(-1, math.Min(1, dot))) * 180 / math.Pi
}

// MarkOpeningsAndTrades sets Opening, Trade and Traded on kills in tick order.
func MarkOpeningsAndTrades(kills []Kill) {
	seen := map[int]bool{}
	for i := range kills {
		if !seen[kills[i].Round] {
			kills[i].Opening = true
			seen[kills[i].Round] = true
		}
	}
	for i := range kills {
		k := &kills[i]
		if k.Attacker == nil || sameSide(k.AttackerSide, k.VictimSide) {
			continue
		}
		for j := i + 1; j < len(kills); j++ {
			a := &kills[j]
			if a.Round != k.Round || a.Tick-k.Tick > TradeTicks {
				break
			}
			if a.Victim == *k.Attacker && a.Attacker != nil && sameSide(a.AttackerSide, k.VictimSide) {
				a.Trade = true
				k.Traded = true
				break
			}
		}
	}
}

func sameSide(a, b *string) bool { return a != nil && b != nil && *a == *b }

// CountKills adds kills, deaths, openings, trades and multi-kills to stats.
func CountKills(kills []Kill, stats func(id string) *PlayerStats) {
	perRound := map[int]map[string]int{}
	for _, k := range kills {
		v := stats(k.Victim)
		v.Deaths++
		if k.Opening && k.Attacker != nil {
			v.OpeningDeaths++
		}
		if k.Traded {
			v.TradedDeaths++
		}
		if k.Assister != nil && (k.Attacker == nil || *k.Assister != *k.Attacker) {
			stats(*k.Assister).Assists++
		}
		if k.Attacker == nil || sameSide(k.AttackerSide, k.VictimSide) {
			continue
		}
		a := stats(*k.Attacker)
		a.Kills++
		if k.Headshot {
			a.HeadshotKills++
		}
		if k.Opening {
			a.OpeningKills++
		}
		if k.Trade {
			a.TradeKills++
		}
		if perRound[k.Round] == nil {
			perRound[k.Round] = map[string]int{}
		}
		perRound[k.Round][*k.Attacker]++
	}
	for _, players := range perRound {
		for id, n := range players {
			if n > 5 {
				n = 5
			}
			stats(id).MultiKills[n-1]++
		}
	}
}

// CountClutches: the first moment one side is down to one player while the
// other still has someone, that player is in a 1vX; won if the side won.
func CountClutches(round Round, roster map[string]string, kills []Kill, stats func(id string) *PlayerStats) {
	alive := map[string]map[string]bool{"CT": {}, "T": {}}
	for id, side := range roster {
		if alive[side] != nil {
			alive[side][id] = true
		}
	}
	clutcher := map[string]string{}
	for _, k := range kills {
		if k.Round != round.Number {
			continue
		}
		delete(alive["CT"], k.Victim)
		delete(alive["T"], k.Victim)
		for _, side := range []string{"CT", "T"} {
			other := "T"
			if side == "T" {
				other = "CT"
			}
			if _, done := clutcher[side]; !done && len(alive[side]) == 1 && len(alive[other]) >= 1 {
				for id := range alive[side] {
					clutcher[side] = id
				}
			}
		}
	}
	for side, id := range clutcher {
		s := stats(id)
		s.ClutchesPlayed++
		if round.Winner != nil && *round.Winner == side {
			s.ClutchesWon++
		}
	}
}

// CountShots adds shots, hits and spray control from one player's shots (in
// tick order) and the ticks they hurt an enemy with a gun.
func CountShots(s *PlayerStats, shots []Shot, hitTicks []int) {
	bullet := make([]int, len(shots))
	for i := range shots {
		if i > 0 && shots[i].Weapon == shots[i-1].Weapon && shots[i].Tick-shots[i-1].Tick <= sprayGapTicks {
			bullet[i] = bullet[i-1] + 1
		}
	}
	s.Shots += len(shots)
	for i := range shots {
		if bullet[i] >= sprayFromBullet {
			s.SprayShots++
		}
	}
	hit := map[int]bool{}
	for _, t := range hitTicks {
		for i := len(shots) - 1; i >= 0; i-- {
			if shots[i].Tick <= t && t-shots[i].Tick <= hitWindowTicks {
				hit[i] = true
				break
			}
			if shots[i].Tick < t-hitWindowTicks {
				break
			}
		}
	}
	s.Hits += len(hit)
	for i := range hit {
		if bullet[i] >= sprayFromBullet {
			s.SprayHits++
		}
	}
}

// CountKast adds a KAST round to each player on the roster who got a kill
// or an assist, survived, or whose death was traded.
func CountKast(round Round, roster map[string]string, kills []Kill, stats func(id string) *PlayerStats) {
	good := map[string]bool{}
	died := map[string]bool{}
	for _, k := range kills {
		if k.Round != round.Number {
			continue
		}
		died[k.Victim] = true
		if k.Traded {
			good[k.Victim] = true
		}
		if k.Attacker != nil && !sameSide(k.AttackerSide, k.VictimSide) {
			good[*k.Attacker] = true
		}
		if k.Assister != nil {
			good[*k.Assister] = true
		}
	}
	for id := range roster {
		if good[id] || !died[id] {
			stats(id).KastRounds++
		}
	}
}
