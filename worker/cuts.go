package main

import "fmt"

// Lower qualities: the platform can ask for a video in several qualities. The
// recorder makes it once, at the highest, and cuts each lower one from it with
// the GPU encoder: smaller and at no more frames than the highest, so nothing
// is made up. Each goes up next to the video (PUT <route>/<height>p<fps>).

// videoCut is one lower quality: a height (16:9) and frame rate.
type videoCut struct {
	Height int `json:"height"`
	FPS    int `json:"fps"`
}

func (c videoCut) name() string { return fmt.Sprintf("%dp%d", c.Height, c.FPS) }

// cuts are the lower qualities of the job's videos (useQuality).
var cuts []videoCut

// validCuts keeps the lower qualities that can be cut from this recorder's
// videos: below its output height, at no more than its frame rate.
func validCuts(in []videoCut) []videoCut {
	var out []videoCut
	for _, c := range in {
		if c.Height >= 240 && c.Height < outputHeight && c.FPS >= 24 && float64(c.FPS) <= outputFPS {
			out = append(out, c)
		}
	}
	return out
}

// cutArgs is the ffmpeg command line that cuts c from the video src into dst.
func cutArgs(encoder, src, dst string, c videoCut) []string {
	h := c.Height &^ 1
	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", fmt.Sprintf("fps=%d", c.FPS)}
	args = append(args, encodeArgsAt(encoder, h, float64(c.FPS), autoBitrate(encoder, h*16/9, h, float64(c.FPS)))...)
	return hwEncodeAt(append(args, "-movflags", "+faststart", dst), encoder, h)
}
