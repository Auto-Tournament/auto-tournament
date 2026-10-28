package main

import (
	"testing"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
)

// Bots all have SteamID64 0: a human's view of two bots must still be two keys.
func TestPairKeepsBotsApart(t *testing.T) {
	human := &common.Player{SteamID64: 76561199486434142, UserID: 2}
	botA := &common.Player{SteamID64: 0, UserID: 5}
	botB := &common.Player{SteamID64: 0, UserID: 6}
	if pair(human, botA) == pair(human, botB) {
		t.Fatal("two bots share a key")
	}
	if pair(human, botA) == pair(botA, human) {
		t.Fatal("the key must keep who sees whom")
	}
}
