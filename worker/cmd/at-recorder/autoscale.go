package main

// `at-recorder autoscale`: starts recorders when jobs wait and stops them after
// they have idled. Off unless AT_AUTOSCALE=1, and only on the GPUs listed in
// AT_AUTOSCALE_GPUS. It acts only on containers scale made (their label) and
// starts the first recorder never and stops it never. planScale decides; this
// reads the state and carries it out.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	autoscaleEvery = time.Minute
	// A new recorder needs time to come up and claim a job: until then the same
	// waiting jobs must not start another one on its card.
	autoscaleSettle = 5 * time.Minute
)

type autoscaleState struct {
	idleSince map[string]time.Time
	lastStart map[string]time.Time
	limits    map[string]int
}

func newAutoscaleState() *autoscaleState {
	return &autoscaleState{idleSince: map[string]time.Time{}, lastStart: map[string]time.Time{}, limits: map[string]int{}}
}

func allowedGPUs(raw string) []string {
	var out []string
	for _, id := range strings.Split(raw, ",") {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

func (a *agent) autoscale(ctx context.Context) error {
	if os.Getenv("AT_AUTOSCALE") != "1" {
		return errors.New("autoscale is off: set AT_AUTOSCALE=1 and AT_AUTOSCALE_GPUS to the GPU UUIDs it may use")
	}
	allowed := allowedGPUs(os.Getenv("AT_AUTOSCALE_GPUS"))
	if len(allowed) == 0 {
		return errors.New("autoscale has no GPUs: set AT_AUTOSCALE_GPUS to the GPU UUIDs it may use")
	}
	log.Printf("autoscale: on, for %s", strings.Join(allowed, ", "))
	st := newAutoscaleState()
	for {
		if err := a.autoscaleTick(ctx, st, allowed, time.Now()); err != nil {
			log.Printf("autoscale: %v", err)
		}
		if err := wait(ctx, autoscaleEvery); err != nil {
			return err
		}
	}
}

type scaledContainer struct {
	name, card string
	running    bool
}

// scaledContainers lists what scale made, by its label.
func (a *agent) scaledContainers(ctx context.Context) ([]scaledContainer, error) {
	b, err := a.run(ctx, "ps", "-a", "--filter", "label="+scaleLabel, "--format", `{{.Names}}|{{.Label "`+scaleLabel+`"}}|{{.State}}`)
	if err != nil {
		return nil, err
	}
	var out []scaledContainer
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if f := strings.Split(line, "|"); len(f) == 3 && f[0] != "" {
			out = append(out, scaledContainer{name: f[0], card: f[1], running: f[2] == "running"})
		}
	}
	return out, nil
}

func (a *agent) autoscaleTick(ctx context.Context, st *autoscaleState, allowed []string, now time.Time) error {
	cards, err := readScaleCards(ctx)
	if err != nil {
		return err
	}
	var queue struct {
		Waiting int `json:"waiting"`
	}
	if err := a.apiPath(ctx, "queue", nil, &queue); err != nil {
		return err
	}
	scaled, err := a.scaledContainers(ctx)
	if err != nil {
		return err
	}
	in := scaleInput{Cards: cards, Allowed: allowed, Recorders: map[string][]scaleRecorder{}, JobsWaiting: queue.Waiting, Limits: st.limits}
	byName := map[string]scaledContainer{}
	for _, c := range scaled {
		byName[c.name] = c
		if !c.running {
			delete(st.idleSince, c.name)
			continue
		}
		in.Recorders[c.card] = append(in.Recorders[c.card], a.recorderState(ctx, c.name, st, now))
	}
	for _, c := range cards {
		// The first recorder counts, on its card, but planScale's stops never reach
		// it: only names in byName are stopped.
		if a.primaryOn(ctx, c.UUID) {
			in.Recorders[c.UUID] = append(in.Recorders[c.UUID], scaleRecorder{Name: "at-recorder", Idle: a.primaryIdle(ctx)})
		}
		a.lowerOnOutOfMemory(ctx, st, c.UUID, in.Recorders[c.UUID])
	}
	a.prepareCopy(ctx, cards, allowed, scaled, in.Recorders, queue.Waiting)
	for _, act := range planScale(in) {
		if act.Start {
			if since, ok := st.lastStart[act.CardUUID]; ok && now.Sub(since) < autoscaleSettle {
				continue
			}
			log.Printf("autoscale: starting a recorder: %s", act.Reason)
			if err := a.startOnCard(ctx, act.CardUUID, cards, scaled, in.Recorders[act.CardUUID]); err != nil {
				log.Printf("autoscale: could not start one: %v", err)
				continue
			}
			st.lastStart[act.CardUUID] = now
			continue
		}
		c, ours := byName[act.Recorder]
		if !ours || !c.running {
			continue
		}
		// Idle a moment ago may be at a job now: stopping one would lose its work.
		if !a.isIdle(ctx, c.name) {
			continue
		}
		log.Printf("autoscale: stopping %s: %s", c.name, act.Reason)
		if _, err := a.run(ctx, "stop", c.name); err != nil {
			log.Printf("autoscale: could not stop %s: %v", c.name, err)
		}
	}
	return nil
}

func (a *agent) isIdle(ctx context.Context, name string) bool {
	_, err := a.run(ctx, "exec", name, "test", "-f", "/mnt/clips/recorder-idle")
	return err == nil
}

func (a *agent) recorderState(ctx context.Context, name string, st *autoscaleState, now time.Time) scaleRecorder {
	r := scaleRecorder{Name: name, Idle: a.isIdle(ctx, name)}
	if !r.Idle {
		delete(st.idleSince, name)
		return r
	}
	if _, ok := st.idleSince[name]; !ok {
		st.idleSince[name] = now
	}
	r.IdleFor = now.Sub(st.idleSince[name])
	return r
}

// lowerOnOutOfMemory lowers a card's limit by one, until this program restarts,
// when one of its recorders just ran out of GPU memory.
func (a *agent) lowerOnOutOfMemory(ctx context.Context, st *autoscaleState, card string, recorders []scaleRecorder) {
	for _, r := range recorders {
		b, err := a.run(ctx, "exec", r.Name, "journalctl", "--since", "-2min", "--no-pager", "_SYSTEMD_USER_UNIT=at-recorder.service")
		if err != nil || !strings.Contains(string(b), "ran out of GPU memory") {
			continue
		}
		limit := max(1, len(recorders)-1)
		if old, ok := st.limits[card]; !ok || limit < old {
			log.Printf("autoscale: %s ran out of GPU memory: at most %d on this card until restart", r.Name, limit)
			st.limits[card] = limit
		}
		return
	}
}

// prepareCopy makes one stopped copy, between jobs, for a card that could run
// another recorder. A copy can only be made while the first recorder is idle,
// which it isn't when jobs wait, so they are made ahead of the need.
func (a *agent) prepareCopy(ctx context.Context, cards []scaleCard, allowed []string, scaled []scaledContainer, recorders map[string][]scaleRecorder, waiting int) {
	if waiting > 0 || !a.primaryIdle(ctx) {
		return
	}
	for _, card := range cards {
		if !slices.Contains(allowed, card.UUID) {
			continue
		}
		have := len(recorders[card.UUID])
		for _, c := range scaled {
			if c.card == card.UUID && !c.running {
				have++
			}
		}
		// How many the card holds at most, whatever is using it right now.
		if (card.TotalMB-scaleReserveMB)/scaleRecorderMB <= have {
			continue
		}
		in, compose, err := a.nextInstance(ctx, card, have)
		if err == nil {
			log.Printf("autoscale: preparing %s for the card at %s", in.Name, card.Bus)
			err = a.makeInstance(ctx, in, compose, false, "create")
		}
		if err != nil {
			log.Printf("autoscale: could not prepare a copy: %v", err)
		}
		return
	}
}

// startOnCard starts a stopped recorder of this card, or makes a new one. A copy
// may be behind on CS2 (only the first recorder updates): it gets the current
// game first.
func (a *agent) startOnCard(ctx context.Context, uuid string, cards []scaleCard, scaled []scaledContainer, recorders []scaleRecorder) error {
	for _, c := range scaled {
		if c.card != uuid || c.running {
			continue
		}
		if err := a.refreshGame(ctx, c.name); err != nil {
			return err
		}
		_, err := a.run(ctx, "start", c.name)
		return err
	}
	for _, card := range cards {
		if card.UUID == uuid {
			in, compose, err := a.nextInstance(ctx, card, len(recorders))
			if err != nil {
				return err
			}
			return a.createInstance(ctx, in, compose, false)
		}
	}
	return fmt.Errorf("no GPU %s here", uuid)
}

func cs2Patch(dir string) string {
	m, _ := filepath.Glob(filepath.Join(dir, "games", "GameLibrary/Steam/steamapps/common/*/game/csgo/steam.inf"))
	if len(m) == 0 {
		return ""
	}
	b, err := os.ReadFile(m[0])
	if err != nil {
		return ""
	}
	for _, l := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(l), "PatchVersion="); ok {
			return v
		}
	}
	return ""
}

// refreshGame gives a stopped copy the first recorder's CS2 when it is behind.
func (a *agent) refreshGame(ctx context.Context, name string) error {
	suffix := strings.TrimPrefix(name, a.name+"-")
	if _, err := strconv.Atoi(suffix); err != nil {
		return fmt.Errorf("%s is not a recorder of this host", name)
	}
	dir := filepath.Join(a.root, "instances", suffix)
	have, want := cs2Patch(dir), cs2Patch(a.root)
	if have == want {
		return nil
	}
	if !a.primaryIdle(ctx) {
		return errors.New("its CS2 is behind and the first recorder is at a job: copying when that is idle")
	}
	log.Printf("autoscale: %s has CS2 %s, updating to %s", name, have, want)
	games := filepath.Join(dir, "games")
	if err := os.RemoveAll(games); err != nil {
		return err
	}
	return copyInstanceFile(ctx, filepath.Join(a.root, "games"), dir)
}
