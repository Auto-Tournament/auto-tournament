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

// reelPlan is everything the reel's ffmpeg needs to know.
type reelPlan struct {
	durations []float64 // each clip's picture length (inputs 0..n-1)
	joins     []join    // how clip i goes into clip i+1 (len n-1)
	intro     bool      // input n holds the intro's frames (full-frame premultiplied RGBA at cardFPS)
	width     int
	height    int
	fps       float64
}

// reelFilter builds the reel: [v] and [a].
func reelFilter(p reelPlan) string {
	var b strings.Builder
	n := len(p.durations)
	// xfade needs every part at one frame rate and time base.
	norm := fmt.Sprintf("fps=%g,settb=AVTB,setsar=1,format=yuv420p", p.fps)
	cols, rows := gridSize(n)
	tiles := cols * rows
	// How many grid tiles each clip feeds.
	uses := make([]int, n)
	if p.intro {
		for t := 0; t < tiles; t++ {
			uses[t%n]++
		}
	}
	// Each clip's picture and sound, exactly its length from 0 (see crossfadeFilter).
	for i, d := range p.durations {
		if uses[i] > 0 {
			fmt.Fprintf(&b, "[%d:v]setpts=PTS-STARTPTS,trim=duration=%.3f,%s,split=%d[v%din]", i, d, norm, 1+uses[i], i)
			for u := 0; u < uses[i]; u++ {
				fmt.Fprintf(&b, "[g%d_%d]", i, u)
			}
			b.WriteString(";")
		} else {
			fmt.Fprintf(&b, "[%d:v]setpts=PTS-STARTPTS,trim=duration=%.3f,%s[v%din];", i, d, norm, i)
		}
		fmt.Fprintf(&b, "[%d:a]asetpts=PTS-STARTPTS,apad,atrim=duration=%.3f[a%din];", i, d, i)
	}

	type part struct {
		v, a string
		d    float64
	}
	var parts []part
	var joins []join
	if p.intro {
		tw, th := (p.width/cols)&^1, (p.height/rows)&^1
		source := introSec / introSlowdown
		next := make([]int, n)
		var layout []string
		for t := 0; t < tiles; t++ {
			i := t % n
			u := next[i]
			next[i]++
			// From around the clip's middle (where its kills are), a different
			// stretch for each repeat; never past its end.
			start := math.Max(0, math.Min(p.durations[i]-source, p.durations[i]*0.3+float64(u)*source*1.3))
			// The top 62 % of the frame: the caption card and the corner tag
			// live in the bottom, and must not show behind the intro's text.
			fmt.Fprintf(&b, "[g%d_%d]trim=start=%.3f:duration=%.3f,setpts=(PTS-STARTPTS)*%g,fps=%g,"+
				"crop=iw:ih*0.62:0:0,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1[t%d];",
				i, u, start, source, introSlowdown, p.fps, tw, th, tw, th, t)
			layout = append(layout, fmt.Sprintf("%d_%d", (t%cols)*tw, (t/cols)*th))
		}
		for t := 0; t < tiles; t++ {
			fmt.Fprintf(&b, "[t%d]", t)
		}
		blur := math.Max(4, float64(p.height)/720*7)
		fmt.Fprintf(&b, "xstack=inputs=%d:layout=%s:fill=black,scale=%d:%d,gblur=sigma=%.1f,drawbox=color=%s:t=fill,"+
			"trim=duration=%.3f,setpts=PTS-STARTPTS,format=yuv420p[grid];", tiles, strings.Join(layout, "|"), p.width, p.height, blur, introDark, introSec)
		fmt.Fprintf(&b, "[%d:v]format=rgba[introtext];[grid][introtext]overlay=0:0:alpha=premultiplied:eof_action=repeat,"+
			"trim=duration=%.3f,setpts=PTS-STARTPTS,%s[vintro];", n, introSec, norm)
		fmt.Fprintf(&b, "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[aintro];", introSec)
		parts = append(parts, part{"vintro", "aintro", introSec})
		joins = append(joins, joinWipe)
	}
	for i, d := range p.durations {
		parts = append(parts, part{fmt.Sprintf("v%din", i), fmt.Sprintf("a%din", i), d})
	}
	joins = append(joins, p.joins...)

	if len(parts) == 1 {
		fmt.Fprintf(&b, "[%s]null[v];[%s]anull[a]", parts[0].v, parts[0].a)
		return b.String()
	}
	length := parts[0].d
	prevV, prevA := parts[0].v, parts[0].a
	for i := 1; i < len(parts); i++ {
		v, a := fmt.Sprintf("jv%d", i), fmt.Sprintf("ja%d", i)
		if i == len(parts)-1 {
			v, a = "v", "a"
		}
		if joins[i-1] == joinWipe {
			// Orange in from the left, a beat of orange, out to the right showing the next clip.
			bar := wipeInSec*2 + wipeHoldSec
			fmt.Fprintf(&b, "color=c=0xff6a3d:s=%dx%d:r=%g:d=%.3f,%s[wc%d];", p.width, p.height, p.fps, bar, norm, i)
			fmt.Fprintf(&b, "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[ws%d];", bar, i)
			fmt.Fprintf(&b, "[%s][wc%d]xfade=transition=wiperight:duration=%g:offset=%.3f[wv%d];", prevV, i, wipeInSec, length-wipeInSec, i)
			fmt.Fprintf(&b, "[%s][ws%d]acrossfade=d=%g[wa%d];", prevA, i, wipeInSec, i)
			length += bar - wipeInSec
			fmt.Fprintf(&b, "[wv%d][%s]xfade=transition=wiperight:duration=%g:offset=%.3f[%s];", i, parts[i].v, wipeInSec, length-wipeInSec, v)
			fmt.Fprintf(&b, "[wa%d][%s]acrossfade=d=%g[%s];", i, parts[i].a, wipeInSec, a)
			length += parts[i].d - wipeInSec
		} else {
			fmt.Fprintf(&b, "[%s][%s]xfade=transition=fade:duration=%g:offset=%.3f[%s];", prevV, parts[i].v, reelCrossfade, length-reelCrossfade, v)
			fmt.Fprintf(&b, "[%s][%s]acrossfade=d=%g[%s];", prevA, parts[i].a, reelCrossfade, a)
			length += parts[i].d - reelCrossfade
		}
		prevV, prevA = v, a
	}
	return strings.TrimSuffix(b.String(), ";")
}

// reelLength is how long reelFilter's reel runs.
func reelLength(p reelPlan) float64 {
	ds := append([]float64{}, p.durations...)
	js := append([]join{}, p.joins...)
	if p.intro {
		ds = append([]float64{introSec}, ds...)
		js = append([]join{joinWipe}, js...)
	}
	total := 0.0
	for i, d := range ds {
		total += d
		if i == 0 {
			continue
		}
		if js[i-1] == joinWipe {
			total += wipeHoldSec
		} else {
			total -= reelCrossfade
		}
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
