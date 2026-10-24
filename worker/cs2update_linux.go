package main

// Keeping CS2 up to date. The recorder's Steam runs in offline mode (every
// recorder can share one account that way), so it never updates CS2 by itself
// and falls behind the demos it plays. While idle, the recorder asks Steam
// whether its CS2 is current and, if not, takes Steam online with its stored
// login just long enough for Steam to update CS2, then back to offline mode.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	// cs2CheckEvery: how often an idle recorder asks Steam whether CS2 is current.
	cs2CheckEvery = 30 * time.Minute
	// cs2UpdateTimeout: how long Steam gets to download and install an update.
	cs2UpdateTimeout = time.Hour
	steamService     = "steam-headless-steam.service"
)

// steamUpToDateURL is Steam's public version check (no key), the version's digits after it.
var steamUpToDateURL = "https://api.steampowered.com/ISteamApps/UpToDateCheck/v1/?appid=730&version="

var (
	reStateFlags = regexp.MustCompile(`"StateFlags"\s+"(\d+)"`)
	reOffline0   = regexp.MustCompile(`("WantsOfflineMode"\s+)"0"`)
	reOffline1   = regexp.MustCompile(`("WantsOfflineMode"\s+)"1"`)
)

// cs2UpToDate asks Steam whether `version` (steam.inf's PatchVersion) is the
// current CS2, and if not, which one is.
func cs2UpToDate(ctx context.Context, version string) (bool, string, error) {
	digits := strings.ReplaceAll(version, ".", "")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, steamUpToDateURL+digits, nil)
	if err != nil {
		return false, "", err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "", err
	}
	defer res.Body.Close()
	var body struct {
		Response struct {
			Success  bool   `json:"success"`
			UpToDate bool   `json:"up_to_date"`
			Message  string `json:"message"` // "Server version required: 1.41.9.2"
		} `json:"response"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return false, "", err
	}
	if !body.Response.Success {
		return false, "", errors.New("Steam could not check the CS2 version")
	}
	want := body.Response.Message
	if i := strings.LastIndex(want, ": "); i >= 0 {
		want = want[i+2:]
	}
	return body.Response.UpToDate, want, nil
}

// maybeUpdateCS2 brings CS2 up to date when it is behind, at most every
// cs2CheckEvery, and reports how it went as a run. The recorder is idle and
// CS2 is closed; it takes no work until this returns.
func (r *recorder) maybeUpdateCS2(ctx context.Context, c *client) {
	if env("AT_CS2_UPDATE", "1") == "0" || time.Since(r.cs2Checked) < cs2CheckEvery {
		return
	}
	r.cs2Checked = time.Now()
	have := cs2Version(r.gameDir)
	connLog := steamConnectionLog()
	if have == "" || !exists(connLog) {
		return // no steam.inf or no Steam desktop here: nothing this can update
	}
	current, want, err := cs2UpToDate(ctx, have)
	if err != nil || current {
		return
	}
	log.Printf("CS2 %s is behind %s: updating it", have, want)
	started := time.Now()
	r.report("updating CS2", fmt.Sprintf("%s to %s", have, want), 0, 0)
	run := jobRun{Kind: "cs2_update"}
	if err := r.updateCS2(ctx, connLog, want); err != nil {
		log.Printf("CS2 update: %v", err)
		run.Error = err.Error()
	} else {
		log.Printf("CS2 is now %s", cs2Version(r.gameDir))
		run.OK = true
	}
	c.reportRun(run, started)
}

// updateCS2 takes Steam online, waits for it to update CS2 to `want` and puts
// it back in offline mode, whatever happened.
func (r *recorder) updateCS2(ctx context.Context, connLog, want string) error {
	users := filepath.Join(filepath.Dir(filepath.Dir(connLog)), "config", "loginusers.vdf")
	if err := setSteamOffline(users, false); err != nil {
		return err
	}
	defer func() {
		if err := setSteamOffline(users, true); err != nil {
			log.Printf("CS2 update: could not set offline mode again: %v", err)
			return
		}
		if err := restartSteam(); err != nil {
			log.Printf("CS2 update: could not restart Steam: %v", err)
			return
		}
		if err := awaitSteam(context.Background(), 2*time.Minute); err != nil {
			log.Printf("CS2 update: Steam back in offline mode: %v", err)
		}
	}()
	if err := restartSteam(); err != nil {
		return err
	}
	if err := waitUntil(ctx, 3*time.Minute, func() bool {
		b, err := os.ReadFile(connLog)
		return err == nil && steamLoggedOn(string(b))
	}); err != nil {
		return errors.New("Steam could not sign in to update CS2: sign Steam in again on the recorder's desktop")
	}
	manifest := filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(r.gameDir))), "appmanifest_730.acf")
	if err := waitUntil(ctx, cs2UpdateTimeout, func() bool {
		b, err := os.ReadFile(manifest)
		m := reStateFlags.FindSubmatch(b)
		// StateFlags 4: fully installed, nothing to update.
		return err == nil && m != nil && string(m[1]) == "4" && (want == "" || cs2Version(r.gameDir) == want)
	}); err != nil {
		return fmt.Errorf("Steam did not finish updating CS2 to %s in %s", want, cs2UpdateTimeout)
	}
	return nil
}

// setSteamOffline sets loginusers.vdf's WantsOfflineMode, read when Steam starts.
func setSteamOffline(users string, offline bool) error {
	b, err := os.ReadFile(users)
	if err != nil {
		return err
	}
	if offline {
		b = reOffline0.ReplaceAll(b, []byte(`$1"1"`))
	} else {
		b = reOffline1.ReplaceAll(b, []byte(`$1"0"`))
	}
	return os.WriteFile(users, b, 0o644)
}

// restartSteam restarts the Steam desktop's Steam (its polkit rules let the
// desktop user restart exactly this unit).
func restartSteam() error {
	if b, err := exec.Command("systemctl", "restart", steamService).CombinedOutput(); err != nil {
		return fmt.Errorf("restart %s: %v %s", steamService, err, strings.TrimSpace(string(b)))
	}
	return nil
}

func waitUntil(ctx context.Context, timeout time.Duration, done func() bool) error {
	deadline := time.Now().Add(timeout)
	for !done() {
		if time.Now().After(deadline) {
			return errors.New("timed out")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
	return nil
}
