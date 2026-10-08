//go:build linux

package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// uploadTwins sends a video's clean twin and its overlay's recipe (overlay.go)
// after the video itself: PUT <route>/clean and <route>/overlay. A platform
// that has no room for them (older) keeps only the dressed video.
func (r *recorder) uploadTwins(ctx context.Context, video, route string) {
	base, _, _ := strings.Cut(route, "?")
	for _, f := range []struct{ path, kind, contentType string }{
		{cleanPathOf(video), "clean", "video/mp4"},
		{overlayPathOf(video), "overlay", "application/json"},
	} {
		if err := r.putFile(ctx, f.path, base+"/"+f.kind, f.contentType); err != nil {
			log.Printf("%s not uploaded: %v", filepath.Base(f.path), err)
		}
	}
}

func (r *recorder) putFile(ctx context.Context, path, route, contentType string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	res, err := r.doWith(ctx, http.MethodPut, route, contentType, f, nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return ok(res, "upload "+filepath.Base(path))
}

// downloadTwins fetches a platform video's clean twin and overlay recipe next
// to its local copy, when the platform has them: `/x/123.mp4` has
// `/x/123.clean.mp4` and `/x/123.overlay.json`. A video without them is
// joined dressed only.
func (r *recorder) downloadTwins(ctx context.Context, videoURL, local string) {
	path, query, _ := strings.Cut(videoURL, "?")
	if !strings.HasSuffix(path, ".mp4") {
		return
	}
	if query != "" {
		query = "?" + query
	}
	stem := strings.TrimSuffix(path, ".mp4")
	for _, f := range []struct{ url, to string }{
		{stem + ".clean.mp4" + query, cleanPathOf(local)},
		{stem + ".overlay.json" + query, overlayPathOf(local)},
	} {
		if err := r.downloadTo(ctx, f.url, f.to); err != nil {
			os.Remove(f.to)
			for _, g := range []string{cleanPathOf(local), overlayPathOf(local)} {
				os.Remove(g)
			}
			if !strings.Contains(err.Error(), fmt.Sprint(http.StatusNotFound)) {
				log.Printf("no clean twin for %s: %v", filepath.Base(path), err)
			}
			return
		}
	}
}
