package main

import (
	"fmt"
	"slices"
	"time"
)

const (
	scaleReserveMB   = 512
	scaleRecorderMB  = 5800
	scaleIdleTimeout = 20 * time.Minute
)

type scaleCard struct {
	UUID    string
	Bus     string
	TotalMB int
	UsedMB  int
}

type scaleRecorder struct {
	Name    string
	Idle    bool
	IdleFor time.Duration
}

type scaleInput struct {
	Cards       []scaleCard
	Allowed     []string                   // card UUIDs; none means no card is touched
	Recorders   map[string][]scaleRecorder // by card UUID
	JobsWaiting int
	Limits      map[string]int // by card UUID; only ever lowers what the card fits
}

type scaleAction struct {
	Start    bool // otherwise stop
	CardUUID string
	Recorder string // set on a stop
	Reason   string
}

// planScale decides which recorders to start and stop. One map stays one CS2
// session, so this only changes how many maps run at once, and never splits one.
func planScale(in scaleInput) []scaleAction {
	// An idle recorder takes the next job by itself, so only the rest need a new one.
	starts := in.JobsWaiting
	for _, recorders := range in.Recorders {
		for _, r := range recorders {
			if r.Idle {
				starts--
			}
		}
	}

	var actions []scaleAction
	for _, card := range in.Cards {
		if !slices.Contains(in.Allowed, card.UUID) {
			continue
		}
		recorders := in.Recorders[card.UUID]
		if starts > 0 && scaleRoom(card, len(recorders), in.Limits) > 0 {
			starts--
			actions = append(actions, scaleAction{Start: true, CardUUID: card.UUID, Reason: fmt.Sprintf(
				"%d jobs waiting, card at %s has %d MB free", in.JobsWaiting, card.Bus, card.TotalMB-card.UsedMB)})
		}
		if in.JobsWaiting > 0 {
			continue
		}
		for _, r := range recorders {
			if r.Idle && r.IdleFor >= scaleIdleTimeout {
				actions = append(actions, scaleAction{CardUUID: card.UUID, Recorder: r.Name, Reason: fmt.Sprintf(
					"no jobs waiting, idle for %s", r.IdleFor.Round(time.Minute))})
			}
		}
	}
	return actions
}

// scaleRoom counts how many more recorders fit. The size of the whole card also
// caps it: a recorder between jobs holds almost no memory, but needs it all back
// at its next job, so free memory alone would put a third on a 12 GB card.
func scaleRoom(card scaleCard, running int, limits map[string]int) int {
	room := min(
		(card.TotalMB-card.UsedMB-scaleReserveMB)/scaleRecorderMB,
		(card.TotalMB-scaleReserveMB)/scaleRecorderMB-running,
	)
	if limit, ok := limits[card.UUID]; ok {
		room = min(room, limit-running)
	}
	return room
}
