package main

import (
	"testing"
	"time"
)

func TestScaleRoom(t *testing.T) {
	const gb12 = 12288
	tests := []struct {
		name    string
		card    scaleCard
		running int
		limits  map[string]int
		want    int
	}{
		{name: "measured: 12 GB card with nothing else fits 2", card: scaleCard{TotalMB: gb12}, want: 2},
		{name: "measured: 1430 MB used by something else fits 1", card: scaleCard{TotalMB: gb12, UsedMB: 1430}, want: 1},
		{name: "one busy recorder's memory is already counted", card: scaleCard{TotalMB: gb12, UsedMB: 5800}, running: 1, want: 1},
		{name: "measured: two busy recorders leave no room for a third", card: scaleCard{TotalMB: gb12, UsedMB: 11700}, running: 2, want: 0},
		{name: "two recorders between jobs leave no room for a third", card: scaleCard{TotalMB: gb12, UsedMB: 300}, running: 2, want: 0},
		{name: "exactly enough free fits 1", card: scaleCard{TotalMB: gb12, UsedMB: gb12 - 6312}, want: 1},
		{name: "one MB short fits 0", card: scaleCard{TotalMB: gb12, UsedMB: gb12 - 6311}, want: 0},
		{name: "24 GB card fits 4", card: scaleCard{TotalMB: 24576}, want: 4},
		{name: "lowered limit caps the card", card: scaleCard{UUID: "a", TotalMB: 24576}, limits: map[string]int{"a": 1}, want: 1},
		{name: "lowered limit counts running recorders", card: scaleCard{UUID: "a", TotalMB: 24576, UsedMB: 5800}, running: 1, limits: map[string]int{"a": 1}, want: 0},
		{name: "limit above the hardware changes nothing", card: scaleCard{UUID: "a", TotalMB: gb12}, limits: map[string]int{"a": 8}, want: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := scaleRoom(tt.card, tt.running, tt.limits); got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestPlanScale(t *testing.T) {
	cardA := scaleCard{UUID: "a", Bus: "01:00.0", TotalMB: 12288}
	cardB := scaleCard{UUID: "b", Bus: "02:00.0", TotalMB: 12288}
	idleLong := scaleRecorder{Name: "r1", Idle: true, IdleFor: 20 * time.Minute}
	idleShort := scaleRecorder{Name: "r2", Idle: true, IdleFor: 19 * time.Minute}
	busy := scaleRecorder{Name: "r3", IdleFor: time.Hour}

	type want struct {
		start    bool
		card     string
		recorder string
	}
	tests := []struct {
		name string
		in   scaleInput
		want []want
	}{
		{
			name: "no card allowed by default",
			in:   scaleInput{Cards: []scaleCard{cardA}, JobsWaiting: 5},
		},
		{
			name: "no start without jobs",
			in:   scaleInput{Cards: []scaleCard{cardA}, Allowed: []string{"a"}},
		},
		{
			name: "one start per card per run, even with room for two",
			in:   scaleInput{Cards: []scaleCard{cardA, cardB}, Allowed: []string{"a", "b"}, JobsWaiting: 5},
			want: []want{{start: true, card: "a"}, {start: true, card: "b"}},
		},
		{
			name: "no more starts than jobs",
			in:   scaleInput{Cards: []scaleCard{cardA, cardB}, Allowed: []string{"a", "b"}, JobsWaiting: 1},
			want: []want{{start: true, card: "a"}},
		},
		{
			name: "only the allowed card starts",
			in:   scaleInput{Cards: []scaleCard{cardA, cardB}, Allowed: []string{"b"}, JobsWaiting: 5},
			want: []want{{start: true, card: "b"}},
		},
		{
			name: "an idle recorder takes the job instead of a new one",
			in: scaleInput{Cards: []scaleCard{cardA}, Allowed: []string{"a"}, JobsWaiting: 1,
				Recorders: map[string][]scaleRecorder{"a": {idleShort}}},
		},
		{
			name: "limit of zero blocks starts",
			in:   scaleInput{Cards: []scaleCard{cardA}, Allowed: []string{"a"}, JobsWaiting: 1, Limits: map[string]int{"a": 0}},
		},
		{
			name: "stops only a recorder idle at least 20 minutes",
			in: scaleInput{Cards: []scaleCard{cardA}, Allowed: []string{"a"},
				Recorders: map[string][]scaleRecorder{"a": {idleLong, idleShort, busy}}},
			want: []want{{card: "a", recorder: "r1"}},
		},
		{
			name: "no stop while jobs wait",
			in: scaleInput{Cards: []scaleCard{cardA}, Allowed: []string{"a"}, JobsWaiting: 1,
				Recorders: map[string][]scaleRecorder{"a": {idleLong}}},
		},
		{
			name: "no stop on a card that isn't allowed",
			in: scaleInput{Cards: []scaleCard{cardA}, Allowed: []string{"b"},
				Recorders: map[string][]scaleRecorder{"a": {idleLong}}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := planScale(tt.in)
			if len(got) != len(tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			for i, w := range tt.want {
				if got[i].Start != w.start || got[i].CardUUID != w.card || got[i].Recorder != w.recorder {
					t.Fatalf("action %d: got %+v, want %+v", i, got[i], w)
				}
				if got[i].Reason == "" {
					t.Fatalf("action %d has no reason", i)
				}
			}
		})
	}
}
