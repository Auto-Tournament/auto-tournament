package main

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
)

// A clip whose camera is not with the player shows the same view all along:
// on 2026-11-03 every clip of a map was CS2's default view of the map and
// shipped. A player's own view always moves. Each frame is compared with the
// one stillGap seconds later; a clip with stillShare or more of its frames
// nearly the same (SSIM above stillSSIM) fails. Measured: such clips 55-100 %,
// clips with the camera on the player 0-2 %.
const (
	stillGap   = 2.0
	stillSSIM  = 0.95
	stillShare = 0.3
)

var reSSIM = regexp.MustCompile(`All:([\d.]+)`)

// stillShareOf is the share of an ssim stats file's frames above stillSSIM.
func stillShareOf(stats string) float64 {
	n, still := 0, 0
	for _, m := range reSSIM.FindAllStringSubmatch(stats, -1) {
		v, _ := strconv.ParseFloat(m[1], 64)
		n++
		if v > stillSSIM {
			still++
		}
	}
	if n == 0 {
		return 0
	}
	return float64(still) / float64(n)
}

// checkNotStill fails a clip (length seconds) whose picture stays the same.
func checkNotStill(path string, length float64) error {
	if length < 2*stillGap {
		return nil
	}
	stats := path + ".ssim.log"
	defer os.Remove(stats)
	out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-ss", fmt.Sprint(stillGap), "-i", path,
		"-lavfi", "[0:v]scale=480:-2,setpts=PTS-STARTPTS[a];[1:v]scale=480:-2,setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file="+stats,
		"-an", "-f", "null", "-").CombinedOutput()
	if err != nil {
		return fmt.Errorf("still check: %v %s", err, out)
	}
	b, err := os.ReadFile(stats)
	if err != nil {
		return err
	}
	if s := stillShareOf(string(b)); s >= stillShare {
		return fmt.Errorf("the picture barely changes (%.0f%% of frames): the camera is not with the player", s*100)
	}
	return nil
}
