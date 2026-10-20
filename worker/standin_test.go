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
