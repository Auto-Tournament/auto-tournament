package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// clipQuality is the frame check of a finished clip, sent with it
// (X-AT-Quality); the platform turns a clip down at 4% repeats or more
// (api: demos/recorders.ts).
type clipQuality struct {
	// RepeatPct: moving frames that barely change from the one before (a
	// frame the capture missed, shown twice), in percent.
	RepeatPct float64 `json:"repeatPct"`
	// JumpPct: moving frames that change much more than their neighbours
	// (frames skipped), in percent.
	JumpPct float64 `json:"jumpPct"`
	// Moving: the frames looked at (still stretches, like a card held on
	// screen, are skipped).
	Moving int `json:"moving"`
}

// frameCheck measures how evenly a clip moves: the picture change between
// each pair of frames (mean absolute difference of the luma, 640 px wide),
// each compared with the median of its 16 neighbours.
func frameCheck(ctx context.Context, path string) (clipQuality, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-v", "error", "-i", path, "-an",
		"-vf", "scale=640:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
		"-f", "null", "-")
	out, err := cmd.StdoutPipe()
	if err != nil {
		return clipQuality{}, err
	}
	if err := cmd.Start(); err != nil {
		return clipQuality{}, err
	}
	var diffs []float64
	sc := bufio.NewScanner(out)
	for sc.Scan() {
		line := sc.Text()
		if i := strings.Index(line, "YAVG="); i >= 0 {
			if v, err := strconv.ParseFloat(strings.TrimSpace(line[i+5:]), 64); err == nil {
				diffs = append(diffs, v)
			}
		}
	}
	if err := cmd.Wait(); err != nil {
		return clipQuality{}, fmt.Errorf("frame check: %w", err)
	}
	return scoreFrames(diffs), nil
}

// scoreFrames counts repeats and jumps in a clip's frame-to-frame changes.
func scoreFrames(d []float64) clipQuality {
	const window = 8
	var q clipQuality
	rep, jmp := 0, 0
	for i := window; i < len(d)-window; i++ {
		near := append(append([]float64{}, d[i-window:i]...), d[i+1:i+window+1]...)
		sort.Float64s(near)
		m := near[len(near)/2]
		if m < 0.6 { // a still stretch
			continue
		}
		q.Moving++
		if d[i] < 0.35*m {
			rep++
		} else if d[i] > 2.2*m {
			jmp++
		}
	}
	if q.Moving > 0 {
		q.RepeatPct = round1(100 * float64(rep) / float64(q.Moving))
		q.JumpPct = round1(100 * float64(jmp) / float64(q.Moving))
	}
	return q
}

func round1(v float64) float64 { return float64(int(v*10+0.5)) / 10 }

// gpuName is the GPU the recorder runs on, for the platform's Recorders page.
func gpuName() string {
	if out, err := exec.Command("nvidia-smi", "--query-gpu=name", "--format=csv,noheader").Output(); err == nil {
		if s := strings.TrimSpace(strings.Split(string(out), "\n")[0]); s != "" {
			return s
		}
	}
	if out, err := exec.Command("glxinfo", "-B").Output(); err == nil {
		for _, l := range strings.Split(string(out), "\n") {
			if strings.Contains(l, "OpenGL renderer string:") {
				return strings.TrimSpace(strings.SplitN(l, ":", 2)[1])
			}
		}
	}
	if out, err := exec.Command("lspci", "-mm").Output(); err == nil {
		for _, l := range strings.Split(string(out), "\n") {
			if strings.Contains(l, "VGA") || strings.Contains(l, "3D controller") {
				f := strings.Split(l, `"`)
				if len(f) >= 6 {
					return f[3] + " " + f[5]
				}
			}
		}
	}
	return ""
}

// platformName is where the recorder runs: "linux/amd64", plus "docker" in a container.
func platformName() string {
	p := runtime.GOOS + "/" + runtime.GOARCH
	if _, err := os.Stat("/.dockerenv"); err == nil {
		p += " · docker"
	}
	return p
}
