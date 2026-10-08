package main

// How a reel is joined (the drafts' picks, 2026-10-08): one player's clips
// blend into each other (a crossfade, reelCrossfade); the next player comes
// in behind an orange wipe, the caption card's bar sweeping across the
// frame. A reel can open with an intro (intro.go) over a grid of its own
// clips, blurred, darkened and in slow motion; the wipe takes it to the
// first clip.

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// The orange wipe: the bar sweeps in over wipeInSec, covers the frame for
// wipeHoldSec and sweeps on, showing the next clip, over wipeInSec.
const (
	wipeInSec   = 0.25
	wipeHoldSec = 0.05
)

// Join is how one part of a reel goes into the next.
type join string

const (
	joinFade join = "fade"
	joinWipe join = "wipe"
)

// introSlowdown is how much slower the intro's grid plays than the clips.
// The clips are 60 or 120 fps, so a quarter speed still moves; under the blur
// it reads as smooth.
const introSlowdown = 4.0

// introDark is the intro grid's shade: the site's paper at 75 %.
const introDark = "0x080504@0.75"

// gridSize is the intro's grid for n clips: 2×2, 3×3, 4×4, else 8×4. Every
// tile shows a clip; with fewer clips than tiles they repeat.
func gridSize(n int) (cols, rows int) {
	switch {
	case n <= 4:
		return 2, 2
	case n <= 9:
		return 3, 3
	case n <= 16:
		return 4, 4
	default:
		return 8, 4
	}
}

// introTile is one tile of the intro's grid: a stretch of one clip.
type introTile struct {
	Clip  int     // which clip
	Start float64 // seconds into it
}

// introTiles picks each tile's clip and stretch: clips in turn, from around
// each clip's middle (where its kills are), a different stretch for each
// repeat, never past the clip's end.
func introTiles(durations []float64) []introTile {
	cols, rows := gridSize(len(durations))
	source := introSec / introSlowdown
	repeats := make([]int, len(durations))
	tiles := make([]introTile, cols*rows)
	for t := range tiles {
		i := t % len(durations)
		u := repeats[i]
		repeats[i]++
		start := math.Max(0, math.Min(durations[i]-source, durations[i]*0.3+float64(u)*source*1.3))
		tiles[t] = introTile{Clip: i, Start: start}
	}
	return tiles
}

// introFilter builds the intro on its own, a cols×rows grid: inputs 0..tiles-1 are the tiles'
// stretches (each already seeked to its start and cut to its length, so
// nothing waits in memory), input `tiles` the intro's text frames (full-frame
// premultiplied RGBA at cardFPS). Output [v] and [a], introSec long.
//
// The intro is a pass of its own: built inside the reel's pass, ten 1440p
// clips each feeding the grid and the reel at once made ffmpeg hold
// seconds of frames for every one of them and run out of memory.
func introFilter(cols, rows, width, height int, fps float64) string {
	var b strings.Builder
	tiles := cols * rows
	tw, th := (width/cols)&^1, (height/rows)&^1
	var layout []string
	for t := 0; t < tiles; t++ {
		// The top 62 % of the frame: the caption card and the corner tag live
		// in the bottom and must not show behind the intro's text.
		fmt.Fprintf(&b, "[%d:v]setpts=(PTS-STARTPTS)*%g,fps=%g,crop=iw:ih*0.62:0:0,"+
			"scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1[t%d];", t, introSlowdown, fps, tw, th, tw, th, t)
		layout = append(layout, fmt.Sprintf("%d_%d", (t%cols)*tw, (t/cols)*th))
	}
	for t := 0; t < tiles; t++ {
		fmt.Fprintf(&b, "[t%d]", t)
	}
	blur := math.Max(4, float64(height)/720*7)
	fmt.Fprintf(&b, "xstack=inputs=%d:layout=%s:fill=black,scale=%d:%d,gblur=sigma=%.1f,drawbox=color=%s:t=fill,"+
		"trim=duration=%.3f,setpts=PTS-STARTPTS,format=yuv420p[grid];", tiles, strings.Join(layout, "|"), width, height, blur, introDark, introSec)
	fmt.Fprintf(&b, "[%d:v]format=rgba[text];[grid][text]overlay=0:0:alpha=premultiplied:eof_action=repeat,"+
		"trim=duration=%.3f,setpts=PTS-STARTPTS,fps=%g,format=yuv420p[v];", tiles, introSec, fps)
	fmt.Fprintf(&b, "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[a]", introSec)
	return b.String()
}

// reelPlan is everything the reel's ffmpeg needs to know.
type reelPlan struct {
	durations []float64 // each part's picture length (inputs 0..n-1; the intro, when there is one, is input 0)
	joins     []join    // how part i goes into part i+1 (len n-1)
	width     int
	height    int
	fps       float64
	// crowd, when set, goes into each part's own sound before the joins
	// (sound.go), so it fades and wipes with its clip.
	crowd *partCrowd
	// crowdOnly: the sound is the crowd alone (the game only opens its
	// murmur), for the reel's separate crowd track; audioOnly leaves the
	// picture out.
	crowdOnly bool
	audioOnly bool
	// outro: the last frame held outroHold longer, then picture and sound
	// fade out (a reel's ending; a clip's pieces join without it).
	outro bool
}

const (
	outroHold = 0.8 // the last frame held this much longer
	outroFade = 1.4 // then faded to black over this
)

// reelFilter joins the parts: [v] and [a].
func reelFilter(p reelPlan) string {
	var b strings.Builder
	// xfade needs every part at one frame rate and time base.
	// Clips recorded at another size (the setting changed since) are scaled to the reel's.
	norm := fmt.Sprintf("fps=%g,settb=AVTB,scale=%d:%d,setsar=1,format=yuv420p", p.fps, p.width, p.height)
	// Each part's picture and sound exactly its length from 0: a clip's sound
	// runs a few hundredths of a second shorter or longer than its picture,
	// and across a reel's joins those add up (1.6 s by the tenth player of a
	// pro reel), so the sound drifted off the picture.
	for i, d := range p.durations {
		if !p.audioOnly {
			fmt.Fprintf(&b, "[%d:v]setpts=PTS-STARTPTS,trim=duration=%.3f,%s[v%din];", i, d, norm, i)
		}
		if p.crowdOnly && !p.crowd.has(i) {
			// No crowd under this part (the intro): silence its length.
			fmt.Fprintf(&b, "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[a%din];", d, i)
			continue
		}
		if p.crowd.has(i) {
			fmt.Fprintf(&b, "[%d:a]asetpts=PTS-STARTPTS,apad,atrim=duration=%.3f[a%draw];", i, d, i)
			b.WriteString(crowdPart(p, i))
			continue
		}
		fmt.Fprintf(&b, "[%d:a]asetpts=PTS-STARTPTS,apad,atrim=duration=%.3f[a%din];", i, d, i)
	}
	finalV, finalA := "v", "a"
	if p.outro {
		finalV, finalA = "vj", "aj"
	}
	if len(p.durations) == 1 {
		if !p.audioOnly {
			fmt.Fprintf(&b, "[v0in]null[%s];", finalV)
		}
		fmt.Fprintf(&b, "[a0in]anull[%s]", finalA)
		return b.String() + outroFilter(p)
	}
	length := p.durations[0]
	prevV, prevA := "v0in", "a0in"
	for i := 1; i < len(p.durations); i++ {
		v, a := fmt.Sprintf("jv%d", i), fmt.Sprintf("ja%d", i)
		if i == len(p.durations)-1 {
			v, a = finalV, finalA
		}
		if p.joins[i-1] == joinWipe {
			// Orange in from the left, a beat of orange, out to the right showing the next part.
			bar := wipeInSec*2 + wipeHoldSec
			if !p.audioOnly {
				fmt.Fprintf(&b, "color=c=0xff6a3d:s=%dx%d:r=%g:d=%.3f,%s[wc%d];", p.width, p.height, p.fps, bar, norm, i)
				fmt.Fprintf(&b, "[%s][wc%d]xfade=transition=wiperight:duration=%g:offset=%.3f[wv%d];", prevV, i, wipeInSec, length-wipeInSec, i)
			}
			fmt.Fprintf(&b, "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[ws%d];", bar, i)
			fmt.Fprintf(&b, "[%s][ws%d]acrossfade=d=%g[wa%d];", prevA, i, wipeInSec, i)
			length += bar - wipeInSec
			if !p.audioOnly {
				fmt.Fprintf(&b, "[wv%d][v%din]xfade=transition=wiperight:duration=%g:offset=%.3f[%s];", i, i, wipeInSec, length-wipeInSec, v)
			}
			fmt.Fprintf(&b, "[wa%d][a%din]acrossfade=d=%g[%s];", i, i, wipeInSec, a)
			length += p.durations[i] - wipeInSec
		} else {
			if !p.audioOnly {
				fmt.Fprintf(&b, "[%s][v%din]xfade=transition=fade:duration=%g:offset=%.3f[%s];", prevV, i, reelCrossfade, length-reelCrossfade, v)
			}
			fmt.Fprintf(&b, "[%s][a%din]acrossfade=d=%g[%s];", prevA, i, reelCrossfade, a)
			length += p.durations[i] - reelCrossfade
		}
		prevV, prevA = v, a
	}
	return strings.TrimSuffix(b.String(), ";") + outroFilter(p)
}

// partStarts is when each part of the plan starts in the reel (reelFilter's joins).
func partStarts(p reelPlan) []float64 {
	starts := make([]float64, len(p.durations))
	length := 0.0
	for i, d := range p.durations {
		if i == 0 {
			length = d
			continue
		}
		if p.joins[i-1] == joinWipe {
			length += wipeInSec*2 + wipeHoldSec - wipeInSec
			starts[i] = length - wipeInSec
			length += d - wipeInSec
		} else {
			starts[i] = length - reelCrossfade
			length += d - reelCrossfade
		}
	}
	return starts
}

// startsHeader is X-AT-Starts: where each clip starts in the reel, in seconds.
func startsHeader(starts []float64) string {
	parts := make([]string, len(starts))
	for i, s := range starts {
		parts[i] = strconv.FormatFloat(s, 'f', 2, 64)
	}
	return strings.Join(parts, ",")
}

// outroFilter is the reel's ending ([vj]/[aj] into [v]/[a]): the last frame
// held, then a fade to black and to silence.
func outroFilter(p reelPlan) string {
	if !p.outro {
		return ""
	}
	end := reelLength(p)
	var b strings.Builder
	if !p.audioOnly {
		fmt.Fprintf(&b, ";[vj]tpad=stop_mode=clone:stop_duration=%g,fade=t=out:st=%.3f:d=%g[v]", outroHold, end-outroFade, outroFade)
	}
	fmt.Fprintf(&b, ";[aj]apad=pad_dur=%g,afade=t=out:st=%.3f:d=%g[a]", outroHold, end-outroFade, outroFade)
	return b.String()
}

// reelLength is how long reelFilter's reel runs.
func reelLength(p reelPlan) float64 {
	total := 0.0
	for i, d := range p.durations {
		total += d
		if i == 0 {
			continue
		}
		if p.joins[i-1] == joinWipe {
			total += wipeHoldSec
		} else {
			total -= reelCrossfade
		}
	}
	if p.outro {
		total += outroHold
	}
	return total
}

// joinsByPlayer: a fade between two clips of the same player, a wipe when
// the player changes.
func joinsByPlayer(players []string) []join {
	var out []join
	for i := 1; i < len(players); i++ {
		if players[i] != "" && players[i] == players[i-1] {
			out = append(out, joinFade)
		} else {
			out = append(out, joinWipe)
		}
	}
	return out
}

// joinDot joins the non-empty parts with " · ".
func joinDot(parts ...string) string {
	var keep []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			keep = append(keep, p)
		}
	}
	return strings.Join(keep, " · ")
}

// titleCase turns a shouted corner tag ("ESL PRO LEAGUE SEASON 24") into a
// line for the intro ("ESL Pro League Season 24"): short words stay as they
// are (acronyms: ESL, IEM), common ones and the rest get a capital and lower case.
func titleCase(s string) string {
	common := map[string]bool{"PRO": true, "CUP": true, "THE": true, "AND": true, "OF": true, "FOR": true, "DAY": true, "MAP": true, "ONE": true, "TWO": true, "TOP": true, "WIN": true}
	words := strings.Fields(s)
	for i, w := range words {
		if (len([]rune(w)) <= 3 && !common[w]) || w != strings.ToUpper(w) {
			continue
		}
		r := []rune(strings.ToLower(w))
		words[i] = strings.ToUpper(string(r[0])) + string(r[1:])
	}
	return strings.Join(words, " ")
}
