//go:build linux

package main

// A map's match reel: each player's best highlight there (already recorded),
// one after the other; each opens with its player's caption card. No CS2
// needed: the clips are downloaded and joined. A tournament reel (its best
// plays) is made the same way.

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type matchReelClip struct {
	HighlightID int     `json:"highlightId"`
	PlayerID    string  `json:"playerId"`
	PlayerName  string  `json:"playerName"`
	Team        *string `json:"team"`
	AvatarURL   *string `json:"avatarUrl"`
	Title       string  `json:"title"`
	URL         string  `json:"url"`
}

type matchReelJob struct {
	Kind         string          `json:"kind"` // match_reel | tournament_reel
	MatchSlug    string          `json:"matchSlug"`
	MapNumber    int             `json:"mapNumber"`
	TournamentID int             `json:"tournamentId"`
	Match        string          `json:"match"`
	Watermark    bool            `json:"watermark"`
	Clips        []matchReelClip `json:"clips"`
	// Where the reel goes, and where to say it could not be made (the
	// platform's routes; older platforms leave them out for match reels).
	Upload string `json:"upload"`
	Fail   string `json:"fail"`
}

func (j *matchReelJob) label() string {
	if j.Kind == "tournament_reel" {
		return fmt.Sprintf("tournament reel of %d", j.TournamentID)
	}
	return fmt.Sprintf("match reel of %s map %d", j.MatchSlug, j.MapNumber)
}

func (j *matchReelJob) uploadRoute(clips int) string {
	if j.Upload != "" {
		return j.Upload
	}
	return fmt.Sprintf("/api/game/cs2/recorder/match-reels/%s/%d?clips=%d", url.PathEscape(j.MatchSlug), j.MapNumber, clips)
}

func (j *matchReelJob) failRoute() string {
	if j.Fail != "" {
		return j.Fail
	}
	return fmt.Sprintf("/api/game/cs2/recorder/match-reels/%s/%d/fail", url.PathEscape(j.MatchSlug), j.MapNumber)
}

func (r *recorder) makeMatchReel(ctx context.Context, j *matchReelJob) error {
	if len(j.Clips) == 0 {
		return fmt.Errorf("no clips")
	}
	dir, err := os.MkdirTemp(r.scratch, "match-reel-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	// Each clip already opens with its player's caption card: download and join.
	var tagged []string
	for i, c := range j.Clips {
		clip := filepath.Join(dir, fmt.Sprintf("clip-%d.mp4", i))
		if err := r.downloadTo(ctx, c.URL, clip); err != nil {
			return fmt.Errorf("%s: %w", c.PlayerName, err)
		}
		tagged = append(tagged, clip)
	}
	reel := filepath.Join(dir, "match.mp4")
	if err := concatFiles(tagged, reel); err != nil {
		return err
	}
	ids := make([]string, len(j.Clips))
	for i, c := range j.Clips {
		ids[i] = strconv.Itoa(c.HighlightID)
	}
	return r.upload(ctx, reel, j.uploadRoute(len(tagged)), map[string]string{"X-AT-Clips": strings.Join(ids, ",")})
}

func (r *recorder) failMatchReel(j *matchReelJob, cause error) {
	log.Printf("%s failed: %v", j.label(), cause)
	msg := cause.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	if res, err := r.postJSON(context.Background(), j.failRoute(), map[string]any{"error": msg}); err == nil {
		res.Body.Close()
	}
}

// downloadTo saves a file from the platform.
func (r *recorder) downloadTo(ctx context.Context, path, to string) error {
	res, err := r.do(ctx, http.MethodGet, path, "", nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := ok(res, "download"); err != nil {
		return err
	}
	f, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, res.Body); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
