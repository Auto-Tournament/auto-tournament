package main

import (
	"fmt"
	"math"
	"strings"
)

// reelSound is what goes under a reel's own sound: a music track, faint, and
// a crowd cheering at the kills worth it (cheers.go). Either can be left out.
type reelSound struct {
	music string      // a music file (looped when the reel is longer), or ""
	crowd string      // a crowd cheer recording, or ""
	kills [][]float64 // each part's cheered kills, seconds into that part (reelPlan order)
}

const (
	musicGain      = 0.11 // under the game's sound
	musicIntroGain = 0.32 // under the intro, which has no game sound
	musicFadeIn    = 1.5
	musicFadeOut   = 2.5
	crowdGain      = 0.22
	crowdDelay     = 0.4 // the crowd reacts this long after the kill
	crowdLen       = 3.0
)

// crowdStarts are where in the crowd recording each cheer is cut from, in
// turn: its loudest stretches, so kills in a row do not sound the same.
var crowdStarts = []float64{8.0, 24.0, 6.5, 9.5}

// partStarts is when each part of the plan starts in the reel (reelFilter's joins).
func partStarts(p reelPlan) []float64 {
	starts := make([]float64, len(p.durations))
	length := 0.0
	for i, d := range p.durations {
		if i > 0 {
			if p.joins[i-1] == joinWipe {
				length += wipeInSec*2 + wipeHoldSec - wipeInSec
				starts[i] = length - wipeInSec
				length += d - wipeInSec
			} else {
				starts[i] = length - reelCrossfade
				length += d - reelCrossfade
			}
			continue
		}
		length = d
	}
	return starts
}

// soundFilter mixes the sound under reelFilter's [a] into [amix]: the music
// is input musicIn, the crowd crowdIn (-1 when there is none).
func soundFilter(p reelPlan, s reelSound, musicIn, crowdIn int, hasIntro bool) string {
	var b strings.Builder
	length := reelLength(p)
	mix := []string{"[a]"}
	if musicIn >= 0 {
		gain := fmt.Sprintf("%g", musicGain)
		if starts := partStarts(p); hasIntro && len(starts) > 1 {
			// Louder under the intro, down to musicGain as the first clip comes in.
			at := starts[1]
			gain = fmt.Sprintf("'if(lt(t,%.3f),%g,if(lt(t,%.3f),%g+(%g)*(t-%.3f)/0.8,%g))':eval=frame",
				at, musicIntroGain, at+0.8, musicIntroGain, musicGain-musicIntroGain, at, musicGain)
		}
		fmt.Fprintf(&b, ";[%d:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=%.3f,asetpts=PTS-STARTPTS,"+
			"volume=%s,afade=t=in:d=%g,afade=t=out:st=%.3f:d=%g[music]",
			musicIn, length, gain, musicFadeIn, math.Max(0, length-musicFadeOut), musicFadeOut)
		mix = append(mix, "[music]")
	}
	if crowdIn >= 0 {
		var at []float64
		starts := partStarts(p)
		for i, ks := range s.kills {
			if i >= len(starts) {
				break
			}
			for _, k := range ks {
				if t := starts[i] + k + crowdDelay; t >= 0 && t < length-0.5 {
					at = append(at, t)
				}
			}
		}
		if len(at) > 0 {
			fmt.Fprintf(&b, ";[%d:a]aresample=48000,aformat=channel_layouts=stereo,asplit=%d", crowdIn, len(at))
			for i := range at {
				fmt.Fprintf(&b, "[cs%d]", i)
			}
			for i, t := range at {
				fmt.Fprintf(&b, ";[cs%d]atrim=start=%g:duration=%g,asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=1.2:d=%g,volume=%g,adelay=%d:all=1[cheer%d]",
					i, crowdStarts[i%len(crowdStarts)], crowdLen, crowdLen-1.2, crowdGain, int(math.Round(t*1000)), i)
				mix = append(mix, fmt.Sprintf("[cheer%d]", i))
			}
		}
	}
	if len(mix) == 1 {
		b.WriteString(";[a]anull[amix]")
		return b.String()
	}
	fmt.Fprintf(&b, ";%samix=inputs=%d:duration=first:normalize=0[amix]", strings.Join(mix, ""), len(mix))
	return b.String()
}
