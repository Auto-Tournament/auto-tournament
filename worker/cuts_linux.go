//go:build linux

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// uploadCuts cuts the job's lower qualities (cuts.go) from a video the
// platform has just taken and sends each next to it. One that fails is left
// out: the video itself is up, and the player plays the qualities it has.
func (r *recorder) uploadCuts(ctx context.Context, video, route string) {
	base, _, _ := strings.Cut(route, "?")
	for _, c := range cuts {
		out := strings.TrimSuffix(video, ".mp4") + "." + c.name() + ".mp4"
		cmd := exec.CommandContext(ctx, "ffmpeg", cutArgs(r.encoder, video, out, c)...)
		if b, err := cmd.CombinedOutput(); err != nil {
			log.Printf("%s not cut: %v %s", filepath.Base(out), err, strings.TrimSpace(string(b)))
			continue
		}
		if err := r.putFile(ctx, out, fmt.Sprintf("%s/%s", base, c.name()), "video/mp4"); err != nil {
			log.Printf("%s not uploaded: %v", filepath.Base(out), err)
		}
		_ = os.Remove(out)
	}
}
