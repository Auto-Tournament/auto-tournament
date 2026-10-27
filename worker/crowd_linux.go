package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// crowdSourceURL is the crowd the reels cheer with: "Crowd Cheering in
// Stadium" by vishiv on Pixabay (pixabay.com/sound-effects/
// people-crowd-cheering-in-stadium-435357). crowdLoud is tuned to it. The
// Pixabay licence does not let us ship it, so each recorder fetches it once.
const crowdSourceURL = "https://cdn.pixabay.com/download/audio/2025/11/12/audio_48b7925981.mp3"

// crowdSource is the crowd recording on disk (AT_CROWD, or fetched into the
// scratch directory the first time), or "" when it cannot be had: the reel
// is then made without a crowd track.
func (r *recorder) crowdSource(ctx context.Context) string {
	if f := env("AT_CROWD", ""); f != "" {
		return f
	}
	dir := r.scratch
	if dir == "" {
		dir = os.TempDir()
	}
	file := filepath.Join(dir, "crowd-435357.mp3")
	if st, err := os.Stat(file); err == nil && st.Size() > 100_000 {
		return file
	}
	if err := fetchFile(ctx, crowdSourceURL, file); err != nil {
		log.Printf("no crowd track: %v", err)
		return ""
	}
	return file
}

// crowdRecordings are the recordings reactions are cut from (sound.go
// crowdTake.src). 0 is the main one (crowdSourceURL); the rest are fetched
// next to it the first time a reaction needs them. All Pixabay, under its
// licence, so like the main one they are fetched, never shipped. 1 to 5 are
// "Free Crowd Cheering Sounds" 01 to 05 by Gregor Quendel (Pixabay 116188 to
// 116192: strong, rhythmic and soft cheering); 6 is "football game in a big
// arena" by freesound_community (Pixabay 31575). THIRD-PARTY-MEDIA.md links them.
var crowdRecordings = []struct{ file, url string }{
	{"", crowdSourceURL},
	{"crowd-116188.mp3", "https://cdn.pixabay.com/download/audio/2022/08/02/audio_af174e495b.mp3"},
	{"crowd-116190.mp3", "https://cdn.pixabay.com/download/audio/2022/08/02/audio_4d8bda8a46.mp3"},
	{"crowd-116189.mp3", "https://cdn.pixabay.com/download/audio/2022/08/02/audio_26fcce2399.mp3"},
	{"crowd-116191.mp3", "https://cdn.pixabay.com/download/audio/2022/08/02/audio_4c4a0a97d1.mp3"},
	{"crowd-116192.mp3", "https://cdn.pixabay.com/download/audio/2022/08/02/audio_227e55a82e.mp3"},
	{"crowd-31575.mp3", "https://cdn.pixabay.com/download/audio/2022/03/10/audio_88abbe3f06.mp3"},
}

// crowdRecording is recording i on disk, next to the main one (`crowd`), or
// "" when it cannot be had: that reaction then comes from the main one.
func crowdRecording(crowd string, i int) string {
	if i == 0 || crowd == "" {
		return crowd
	}
	if i < 0 || i >= len(crowdRecordings) {
		return ""
	}
	file := filepath.Join(filepath.Dir(crowd), crowdRecordings[i].file)
	if st, err := os.Stat(file); err == nil && st.Size() > 100_000 {
		return file
	}
	if err := fetchFile(context.Background(), crowdRecordings[i].url, file); err != nil {
		log.Printf("crowd recording %s: %v", crowdRecordings[i].file, err)
		return ""
	}
	return file
}

// awwSourceURL is the crowd's groan when the player dies: "Crowd
// Disappointment Reaction" by Universfield on Pixabay (pixabay.com/
// sound-effects/people-crowd-disappointment-reaction-352718). Fetched like
// the cheer, next to it.
const awwSourceURL = "https://cdn.pixabay.com/audio/2025/06/02/audio_9dd11cb4aa.mp3"

// awwSource is the groan recording on disk (AT_CROWD_AWW, or fetched next to
// the crowd recording), or "" when it cannot be had: deaths then go quiet.
func awwSource(crowd string) string {
	if f := env("AT_CROWD_AWW", ""); f != "" {
		return f
	}
	if crowd == "" {
		return ""
	}
	file := filepath.Join(filepath.Dir(crowd), "crowd-aww-352718.mp3")
	if st, err := os.Stat(file); err == nil && st.Size() > 10_000 {
		return file
	}
	if err := fetchFile(context.Background(), awwSourceURL, file); err != nil {
		log.Printf("no crowd groan: %v", err)
		return ""
	}
	return file
}

func fetchFile(ctx context.Context, url, file string) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Auto Tournament recorder)")
	req.Header.Set("Referer", "https://pixabay.com/")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %d", url, res.StatusCode)
	}
	tmp := file + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	n, err := io.Copy(f, res.Body)
	f.Close()
	if err != nil || n < 10_000 {
		os.Remove(tmp)
		if err == nil {
			err = fmt.Errorf("only %d bytes", n)
		}
		return err
	}
	return os.Rename(tmp, file)
}

// uploadCrowd sends a reel's crowd track (made next to it) to the reel's
// route with /crowd, when there is one.
func (r *recorder) uploadCrowd(ctx context.Context, reel, route string) {
	track := crowdTrackPath(reel)
	f, err := os.Open(track)
	if err != nil {
		return
	}
	defer f.Close()
	base, _, _ := strings.Cut(route, "?")
	res, err := r.doWith(ctx, http.MethodPut, base+"/crowd", "audio/mp4", f, nil)
	if err == nil {
		defer res.Body.Close()
		err = ok(res, "upload "+filepath.Base(track))
	}
	if err != nil {
		log.Printf("crowd track not uploaded: %v", err)
	}
}
