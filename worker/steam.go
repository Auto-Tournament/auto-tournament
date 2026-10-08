package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Steam's connection states, as its connection log writes them:
// "[2026-10-07 19:05:27] [Logged On, 4, 7] [U:1:…] …".
var reSteamState = regexp.MustCompile(`\] \[(Connecting|Connected|Logging On|Logged On|Logging Off|Logged Off|Disconnected)[,\]]`)

// steamLoggedOn tells from Steam's connection log whether its last state is
// logged on.
func steamLoggedOn(connectionLog string) bool {
	states := reSteamState.FindAllStringSubmatch(connectionLog, -1)
	return len(states) > 0 && states[len(states)-1][1] == "Logged On"
}

// reSteamOffline is Steam in offline mode with its account set: it never logs
// on, it sets the user it runs as and stays "Logged Off".
var reSteamOffline = regexp.MustCompile(`\] \[Logged Off, \d+, \d+\] \[U:1:\d+\] CCMInterface::SetSteamID\(`)

// steamOfflineReady tells whether Steam, last started in offline mode (every
// recorder can share one account that way: demo playback needs no session),
// has its account set: the log's last state line is that.
func steamOfflineReady(connectionLog string) bool {
	states := reSteamState.FindAllStringIndex(connectionLog, -1)
	if len(states) == 0 {
		return false
	}
	last := connectionLog[states[len(states)-1][0]:]
	return reSteamOffline.MatchString(last)
}

// steamWantsOffline is whether Steam is set to start in offline mode
// (loginusers.vdf next to the log's folder: "WantsOfflineMode" "1").
func steamWantsOffline(connectionLog string) bool {
	b, err := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(connectionLog)), "config", "loginusers.vdf"))
	return err == nil && reWantsOffline.Match(b)
}

var reWantsOffline = regexp.MustCompile(`"WantsOfflineMode"\s+"1"`)

// steamConnectionLog is where Steam writes its connection log
// (AT_STEAM_CONNECTION_LOG overrides it).
func steamConnectionLog() string {
	if p := env("AT_STEAM_CONNECTION_LOG", ""); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "Steam", "logs", "connection_log.txt")
}

// awaitSteam waits until Steam has logged on (or, in offline mode, set its
// account). CS2 started before then has no
// Steam to talk to: it shows an error dialog and quits, and the recorder only
// notices once the map never loads, minutes later. Without the log (no Steam
// desktop here), it does not wait.
func awaitSteam(ctx context.Context, timeout time.Duration) error {
	path := steamConnectionLog()
	deadline := time.Now().Add(timeout)
	for {
		b, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err == nil && (steamLoggedOn(string(b)) || (steamWantsOffline(path) && steamOfflineReady(string(b)))) {
			return nil
		}
		if time.Now().After(deadline) {
			return errors.New("Steam has not logged on (see " + path + ")")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}
