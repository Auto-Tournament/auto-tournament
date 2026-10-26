package main

// A reel's picture in pieces: each part's middle on its own and each join (a
// crossfade, or the orange wipe) from just the two parts it joins, then the
// pieces glued without encoding again (ffmpeg's concat demuxer). One ffmpeg
// with every part as an input and xfades chained through them decoded ahead
// and queued frames until each join needed them: a 4K series reel grew to
// 28 GB and was killed (2026-10-25). Piece by piece it holds a few frames.
// The sound still goes through reelFilter in one pass: it is small.

import (
	"fmt"
	"math"
	"strings"
)

// reelPiece is one piece of a reel's picture: part `a` from `from` for `length`
// seconds, or (b >= 0) the join of part a's tail into part b's head.
type reelPiece struct {
	a, b   int
	from   float64
	length float64
	join   join
	// start: where it begins in the reel; frames: how many it has, from the
	// reel's own frame grid, so rounding never adds up across the pieces.
	start  float64
	frames int
}

// joinLength is how long the join into part i takes in the reel (its piece).
func joinLength(j join) float64 {
	if j == joinWipe {
		return wipeInSec*2 + wipeHoldSec
	}
	return reelCrossfade
}

// joinOverlap is how much of each of the two parts a join uses.
func joinOverlap(j join) float64 {
	if j == joinWipe {
		return wipeInSec
	}
	return reelCrossfade
}

// reelPieces lays the plan out as pieces, in order. They add up to reelLength.
func reelPieces(p reelPlan) []reelPiece {
	var out []reelPiece
	at := 0.0
	add := func(pc reelPiece) {
		if pc.length <= 0.0005 {
			return
		}
		pc.start = at
		at += pc.length
		pc.frames = int(math.Round(at*p.fps)) - int(math.Round(pc.start*p.fps))
		out = append(out, pc)
	}
	n := len(p.durations)
	for i := 0; i < n; i++ {
		head, tail := 0.0, 0.0
		if i > 0 {
			head = joinOverlap(p.joins[i-1])
		}
		if i < n-1 {
			tail = joinOverlap(p.joins[i])
		}
		add(reelPiece{a: i, b: -1, from: head, length: p.durations[i] - head - tail})
		if i < n-1 {
			add(reelPiece{a: i, b: i + 1, from: p.durations[i] - tail, length: joinLength(p.joins[i]), join: p.joins[i]})
		}
	}
	if p.outro && len(out) > 0 {
		// The last frame held outroHold longer: part of the last piece.
		last := &out[len(out)-1]
		last.length += outroHold
		last.frames = int(math.Round((last.start+last.length)*p.fps)) - int(math.Round(last.start*p.fps))
	}
	return out
}

// pieceFilter is one piece's picture as [v]: inputs 0 (and 1 for a join) are
// already seeked to the stretch they give, so nothing waits.
func pieceFilter(p reelPlan, pc reelPiece, first, last bool) string {
	norm := fmt.Sprintf("fps=%g,settb=AVTB,scale=%d:%d,setsar=1,format=yuv420p", p.fps, p.width, p.height)
	var b strings.Builder
	fmt.Fprintf(&b, "[0:v]setpts=PTS-STARTPTS,%s[pa];", norm)
	out := "pa"
	switch {
	case pc.b < 0:
	case pc.join == joinWipe:
		bar := joinLength(joinWipe)
		fmt.Fprintf(&b, "[1:v]setpts=PTS-STARTPTS,%s[pb];", norm)
		fmt.Fprintf(&b, "color=c=0xff6a3d:s=%dx%d:r=%g:d=%.3f,%s[bar];", p.width, p.height, p.fps, bar, norm)
		fmt.Fprintf(&b, "[pa][bar]xfade=transition=wiperight:duration=%g:offset=0[pw];", wipeInSec)
		fmt.Fprintf(&b, "[pw][pb]xfade=transition=wiperight:duration=%g:offset=%.3f[pj];", wipeInSec, bar-wipeInSec)
		out = "pj"
	default:
		fmt.Fprintf(&b, "[1:v]setpts=PTS-STARTPTS,%s[pb];", norm)
		fmt.Fprintf(&b, "[pa][pb]xfade=transition=fade:duration=%g:offset=0[pj];", reelCrossfade)
		out = "pj"
	}
	var tail []string
	if p.outro && first {
		tail = append(tail, fmt.Sprintf("fade=t=in:d=%g", introFade))
	}
	if p.outro && last {
		tail = append(tail, fmt.Sprintf("tpad=stop_mode=clone:stop_duration=%g", outroHold),
			fmt.Sprintf("fade=t=out:st=%.3f:d=%g", math.Max(0, pc.length-outroFade), outroFade))
	}
	if len(tail) == 0 {
		tail = []string{"null"}
	}
	fmt.Fprintf(&b, "[%s]%s[v]", out, strings.Join(tail, ","))
	return b.String()
}

// pieceInputs are a piece's inputs as ffmpeg arguments: each part seeked to
// the stretch the piece takes from it.
func pieceInputs(p reelPlan, pc reelPiece, paths []string) []string {
	if pc.b < 0 {
		return []string{"-ss", fmt.Sprintf("%.4f", pc.from), "-t", fmt.Sprintf("%.4f", pc.length+0.05), "-i", paths[pc.a]}
	}
	o := joinOverlap(pc.join)
	return []string{
		"-ss", fmt.Sprintf("%.4f", pc.from), "-t", fmt.Sprintf("%.4f", o+0.05), "-i", paths[pc.a],
		"-ss", "0", "-t", fmt.Sprintf("%.4f", o+0.05), "-i", paths[pc.b],
	}
}
