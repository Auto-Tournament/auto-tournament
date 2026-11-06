package main

import (
	"testing"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
)

func TestStandInMakesANamedBotTheRosterPlayer(t *testing.T) {
	ada := &common.Player{Name: "Ada", IsBot: true}
	other := &common.Player{Name: "Wolf", IsBot: true}
	human := &common.Player{Name: "Ada", SteamID64: 76561198000000001}
	standIn([]*common.Player{ada, other, human}, map[string]uint64{"Ada": 76561198000000002})
	if ada.IsBot || ada.SteamID64 != 76561198000000002 {
		t.Fatalf("the bot named Ada should play as her: %+v", ada)
	}
	if !other.IsBot || other.SteamID64 != 0 {
		t.Fatal("a bot without a roster name stays a bot")
	}
	if human.SteamID64 != 76561198000000001 {
		t.Fatal("a human keeps their own SteamID")
	}
}

func TestBotForPicksTheTakenOverBotInTheStretch(t *testing.T) {
	r := &Replay{Takeovers: []Takeover{{Tick: 32015, Player: "1", Bot: "Hugg"}, {Tick: 40000, Player: "2", Bot: "Kask"}}}
	if got := r.BotFor("1", 31800, 32200); got != "Hugg" {
		t.Fatalf("got %q, want Hugg", got)
	}
	if got := r.BotFor("1", 20000, 21000); got != "" {
		t.Fatalf("a stretch without a takeover kill: got %q", got)
	}
	if got := r.BotFor("1", 39000, 41000); got != "" {
		t.Fatalf("another player's takeover: got %q", got)
	}
	if got := (*Replay)(nil).BotFor("1", 0, 1<<30); got != "" {
		t.Fatalf("no replay: got %q", got)
	}
}
