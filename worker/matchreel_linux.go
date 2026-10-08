//go:build linux

package main

// A map's match reel: each player's best highlight there (already recorded),
// one after the other, the orange wipe between players, after an intro over
// a grid of the clips; each opens with its player's caption card. No CS2 needed: the clips are downloaded and joined.
// A tournament reel (its best plays) is made the same way.

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
	// Markers are its kills and the crowd's reactions, for the reel's crowd.
	Markers *clipMarkers `json:"markers"`
}

type matchReelJob struct {
	Kind         string          `json:"kind"` // match_reel | tournament_reel | team_reel | player_reel
	MatchSlug    string          `json:"matchSlug"`
	MapNumber    int             `json:"mapNumber"`
	TournamentID int             `json:"tournamentId"`
	TeamID       string          `json:"teamId"`
	Match        string          `json:"match"`
	Watermark    bool            `json:"watermark"`
	Quality      *videoQuality   `json:"quality"`
	Clips        []matchReelClip `json:"clips"`
	// Intro is what the reel opens with (older platforms: none).
	Intro *reelIntro `json:"intro"`
	// Where the reel goes, and where to say it could not be made (the
	// platform's routes; older platforms leave them out for match reels).
	Upload string `json:"upload"`
	Fail   string `json:"fail"`
}

func (j *matchReelJob) label() string {
	if j.Kind == "tournament_reel" {
		return fmt.Sprintf("tournament reel of %d", j.TournamentID)
	}
	if j.Kind == "team_reel" {
		return fmt.Sprintf("team reel of %s for %s", j.MatchSlug, j.TeamID)
	}
	if j.Kind == "player_reel" {
		return fmt.Sprintf("player reel of %s map %d", j.MatchSlug, j.MapNumber)
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
	r.useQuality(j.Quality)
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
		r.downloadTwins(ctx, c.URL, clip)
		tagged = append(tagged, clip)
	}
	reel := filepath.Join(dir, "match.mp4")
	sound := reelSound{crowd: r.crowdSource(ctx), crowdOut: crowdTrackPath(reel), outro: true}
	for _, c := range j.Clips {
		var reactions []reaction
		if c.Markers != nil {
			reactions = c.Markers.Reactions
		}
		sound.reactions = append(sound.reactions, reactions)
	}
	starts, err := r.buildReelSound(tagged, wipes(len(tagged)), j.Intro, sound, reel)
	if err != nil {
		return err
	}
	ids := make([]string, len(j.Clips))
	for i, c := range j.Clips {
		ids[i] = strconv.Itoa(c.HighlightID)
	}
	if err := r.upload(ctx, reel, j.uploadRoute(len(tagged)), map[string]string{"X-AT-Clips": strings.Join(ids, ","), "X-AT-Starts": startsHeader(starts)}); err != nil {
		return err
	}
	r.uploadCrowd(ctx, reel, j.uploadRoute(len(tagged)))
	return nil
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
