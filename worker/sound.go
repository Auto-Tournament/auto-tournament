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
	heys  [][]float64 // each part's kills for a short "heeey", seconds into that part (reelPlan order)
	roars [][]float64 // each part's kills for a roar
}

const (
	musicGain          = 0.11 // under the game's sound
	musicIntroGain     = 0.32 // under the intro, which has no game sound
	musicFadeIn        = 1.5
	musicFadeOut       = 2.5
	crowdBedGain       = 0.07 // the crowd murmur while there is action
	crowdGateThreshold = 0.03 // game sound (RMS) that opens the murmur
	crowdGateRange     = 0.02 // what is left of it when the game is quiet
	heyGain            = 0.16 // a "heeey" at its height
	roarGain           = 0.26 // a roar at its height
	crowdDelay         = 0.4  // the crowd reacts this long after the kill
)

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
		// The crowd follows the game: it murmurs while there is action (a
		// gate opened by the game's own sound, slow to close) and is quiet
		// when the game is; it reacts to the kills worth it on top.
		starts := partStarts(p)
		from := 0.0
		if hasIntro && len(starts) > 1 {
			from = starts[1]
		}
		span := math.Max(0.1, length-from)
		var swells []string
		add := func(parts [][]float64, peak, rise, hold, fall float64) {
			for i, ks := range parts {
				if i >= len(starts) {
					break
				}
				for _, k := range ks {
					a := starts[i] + k + crowdDelay - from
					if a < 0 || a > span {
						continue
					}
					swells = append(swells, fmt.Sprintf("%g*min(1,max(0,(t-%.3f)/%g))*min(1,max(0,(%.3f-t)/%g))",
						peak, a, rise, a+rise+hold+fall, fall))
				}
			}
		}
		add(s.heys, heyGain, 0.2, 0.6, 1.0)
		add(s.roars, roarGain, 0.35, 1.6, 2.2)
		react := "0"
		if len(swells) > 0 {
			react = strings.Join(swells, "+")
		}
		mix[0] = "[agame]"
		fmt.Fprintf(&b, ";[a]asplit=2[agame][asc]")
		fmt.Fprintf(&b, ";[asc]atrim=start=%.3f,asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[side]", from)
		fmt.Fprintf(&b, ";[%d:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=%.3f,asetpts=PTS-STARTPTS,asplit=2[crowdbed][crowdreact]", crowdIn, span)
		fmt.Fprintf(&b, ";[crowdbed]volume=%g[crowdbedv];[crowdbedv][side]sidechaingate=threshold=%g:ratio=8:attack=120:release=2200:range=%g:knee=3:detection=rms[bed]",
			crowdBedGain, crowdGateThreshold, crowdGateRange)
		fmt.Fprintf(&b, ";[crowdreact]volume='%s':eval=frame[react]", react)
		fmt.Fprintf(&b, ";[bed][react]amix=inputs=2:duration=first:normalize=0,afade=t=in:d=1,afade=t=out:st=%.3f:d=2,adelay=%d:all=1[crowd]",
			math.Max(0, span-2), int(math.Round(from*1000)))
		mix = append(mix, "[crowd]")
	}
	if len(mix) == 1 {
		b.WriteString(";[a]anull[amix]")
		return b.String()
	}
	fmt.Fprintf(&b, ";%samix=inputs=%d:duration=first:normalize=0[amix]", strings.Join(mix, ""), len(mix))
	return b.String()
}
