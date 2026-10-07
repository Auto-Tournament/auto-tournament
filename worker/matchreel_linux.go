//go:build linux

package main

// A map's match reel: each player's best highlight there (already recorded),
// one after the other, with a small name tag in the top left throughout so
// it is clear whose play it is. No CS2 needed: the clips are downloaded,
// tagged and joined. A tournament reel (its best plays) is made the same way.

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
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

// tagScale is the name tag's size against the caption card's.
const tagScale = 0.62

func (r *recorder) makeMatchReel(ctx context.Context, j *matchReelJob) error {
	if len(j.Clips) == 0 {
		return fmt.Errorf("no clips")
	}
	dir, err := os.MkdirTemp(r.scratch, "match-reel-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	var tagged []string
	for i, c := range j.Clips {
		clip := filepath.Join(dir, fmt.Sprintf("clip-%d.mp4", i))
		if err := r.downloadTo(ctx, c.URL, clip); err != nil {
			return fmt.Errorf("%s: %w", c.PlayerName, err)
		}
		card := captionCard{name: c.PlayerName}
		if c.Team != nil {
			card.moment = *c.Team
		}
		if c.AvatarURL != nil && *c.AvatarURL != "" {
			if img, err := r.fetchAvatar(ctx, *c.AvatarURL); err == nil {
				card.avatar = img
			} else {
				log.Printf("no avatar for %s: %v", c.PlayerName, err)
			}
		}
		tag, err := card.render(int(float64(r.height) * tagScale))
		if err != nil {
			return err
		}
		tagPath := filepath.Join(dir, fmt.Sprintf("tag-%d.png", i))
		if err := os.WriteFile(tagPath, tag, 0o644); err != nil {
			return err
		}
		out := filepath.Join(dir, fmt.Sprintf("tagged-%d.mp4", i))
		margin := r.height / 18
		args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", clip,
			"-loop", "1", "-framerate", fmt.Sprint(outputFPS), "-i", tagPath,
			"-filter_complex", fmt.Sprintf("[1:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1[tag];[0:v][tag]overlay=%d:%d:shortest=1,format=yuv420p[v]", margin, margin),
			"-map", "[v]", "-map", "0:a"}
		args = append(args, encodeArgs(r.encoder)...)
		args = append(args, "-c:a", "copy", "-movflags", "+faststart", out)
		if b, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("ffmpeg tag: %v %s", err, strings.TrimSpace(string(b)))
		}
		tagged = append(tagged, out)
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
