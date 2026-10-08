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

// soundFilter mixes the music (input musicIn, -1 for none) under
// reelFilter's [a] into [amix]. The crowd is already in each part's sound
// (crowdPart).
func soundFilter(p reelPlan, s reelSound, musicIn int, hasIntro bool) string {
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
	if len(mix) == 1 {
		b.WriteString(";[a]anull[amix]")
		return b.String()
	}
	fmt.Fprintf(&b, ";%samix=inputs=%d:duration=first:normalize=0[amix]", strings.Join(mix, ""), len(mix))
	return b.String()
}

// partCrowd is the crowd under each clip of a reel: input `input` (looped),
// in the parts from `first` on (not under the intro), reacting to each
// part's kills.
type partCrowd struct {
	input int
	first int
	heys  [][]float64 // per part (reelPlan order): kills for a "heeey", seconds into the part
	roars [][]float64 // per part: kills for a roar
}

func (c *partCrowd) has(part int) bool { return c != nil && part >= c.first }

// crowdSplit hands each part with a crowd its own copy of the crowd recording.
func crowdSplit(p reelPlan) string {
	c := p.crowd
	if c == nil || c.first >= len(p.durations) {
		return ""
	}
	n := len(p.durations) - c.first
	var b strings.Builder
	fmt.Fprintf(&b, "[%d:a]aresample=48000,aformat=channel_layouts=stereo,asplit=%d", c.input, n)
	for i := c.first; i < len(p.durations); i++ {
		fmt.Fprintf(&b, "[crowd%d]", i)
	}
	b.WriteString(";")
	return b.String()
}

// crowdPart mixes the crowd into part i's sound ([a<i>raw] into [a<i>in]):
// silent through the slowed opening, then a murmur that follows the clip's own sound (a gate the game opens, slow to
// close), and its reactions, all within the clip, so a crossfade or the
// wipe takes them along with the picture.
func crowdPart(p reelPlan, i int) string {
	c := p.crowd
	d := p.durations[i]
	// Each clip from its own stretch of the recording, so they do not all start alike.
	start := math.Mod(float64(i-c.first)*7.3, 24)
	var swells []string
	add := func(parts [][]float64, peak, rise, hold, fall float64) {
		if i >= len(parts) {
			return
		}
		for _, k := range parts[i] {
			a := k + crowdDelay
			if a >= d {
				continue
			}
			swells = append(swells, fmt.Sprintf("%g*min(1,max(0,(t-%.3f)/%g))*min(1,max(0,(%.3f-t)/%g))",
				peak, a, rise, a+rise+hold+fall, fall))
		}
	}
	add(c.heys, heyGain, 0.2, 0.6, 1.0)
	add(c.roars, roarGain, 0.35, 1.6, 2.2)
	react := "0"
	if len(swells) > 0 {
		react = strings.Join(swells, "+")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "[a%draw]asplit=2[a%dgame][a%dside];", i, i, i)
	fmt.Fprintf(&b, "[crowd%d]atrim=start=%.3f:duration=%.3f,asetpts=PTS-STARTPTS,asplit=2[cb%d][cr%d];", i, start, d, i, i)
	fmt.Fprintf(&b, "[cb%d]volume=%g[cbv%d];[cbv%d][a%dside]sidechaingate=threshold=%g:ratio=8:attack=120:release=2200:range=%g:knee=3:detection=rms[bed%d];",
		i, crowdBedGain, i, i, i, crowdGateThreshold, crowdGateRange, i)
	fmt.Fprintf(&b, "[cr%d]volume='%s':eval=frame[react%d];", i, react, i)
	// Silent through the clip's slowed opening under the caption card, in as it reaches full speed.
	quiet := cardExit + introUpSec
	fmt.Fprintf(&b, "[bed%d][react%d]amix=inputs=2:duration=first:normalize=0,volume='if(lt(t,%.3f),0,min(1,(t-%.3f)/0.6))':eval=frame[crowdmix%d];",
		i, i, quiet, quiet, i)
	fmt.Fprintf(&b, "[a%dgame][crowdmix%d]amix=inputs=2:duration=first:normalize=0[a%din];", i, i, i)
	return b.String()
}
