package main

import (
	"fmt"
	"math"
	"strings"
)

// reelSound is what goes under a reel's own sound: a music track, faint, and
// a crowd cheering at the kills worth it (cheers.go). Either can be left out.
type reelSound struct {
	music     string       // a music file (looped when the reel is longer), or ""
	crowd     string       // a crowd cheer recording, or ""
	reactions [][]reaction // each part's crowd reactions, seconds into that part (reelPlan order)
}

const (
	musicGain          = 0.11 // under the game's sound
	musicIntroGain     = 0.32 // under the intro, which has no game sound
	musicFadeIn        = 1.5
	musicFadeOut       = 2.5
	crowdBedGain       = 0.07 // the crowd murmur while there is action
	crowdGateThreshold = 0.03 // game sound (RMS) that opens the murmur
	crowdGateRange     = 0.02 // what is left of it when the game is quiet
	heyGain            = 0.22 // a "heeey" at its height
	roarGain           = 0.27 // a cheer at its height
	wowGain            = 0.34 // a "whoaaa" at its height
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
	if p.crowd != nil && len(p.crowd.reacts) > 0 {
		b.WriteString(reactFilter(p.crowd.reacts))
		mix = append(mix, "[reacts]")
	}
	if len(mix) == 1 {
		b.WriteString(";[a]anull[amix]")
		return b.String()
	}
	fmt.Fprintf(&b, ";%samix=inputs=%d:duration=first:normalize=0[amix]", strings.Join(mix, ""), len(mix))
	return b.String()
}

// partCrowd is the crowd in a reel: under each clip from `first` on (not
// under the intro) a murmur from its own input (bedIn, a stretch of the
// recording), and the reactions to the kills worth it, each its own input,
// placed on the reel's timeline so a tail can carry into the next clip.
type partCrowd struct {
	first  int
	bedIn  map[int]int // part -> input with its murmur
	reacts []crowdReact
}

// crowdReact is one reaction: input `in` (a stretch of the recording from
// `from`, `length` long), at `at` seconds into the reel.
type crowdReact struct {
	in     int
	from   float64
	at     float64
	score  float64
	length float64
}

// crowdLoud are where the crowd recording cheers loudest: each reaction is
// cut from one of them, in turn, so it is never a quiet stretch.
var crowdLoud = []float64{7.0, 24.0, 8.6, 25.2, 9.6}

// crowdBedSpan is the stretch of the recording part i's murmur plays: its
// slowed opening takes slowmoSpeed as much.
func crowdBedSpan(p reelPlan, first, i int) (start, length float64) {
	d := p.durations[i]
	slow := math.Min(cardExit, d)
	return math.Mod(float64(i-first)*7.3, 24), slow*slowmoSpeed + (d - slow)
}

// crowdReactions places each part's reactions on the reel's timeline:
// crowdDelay after the kill, cut from crowdLoud in turn. A tail may run
// crowdSpill seconds into the next clip.
func crowdReactions(p reelPlan, first int, reactions [][]reaction) []crowdReact {
	starts := partStarts(p)
	var out []crowdReact
	n := 0
	for i := first; i < len(p.durations) && i < len(reactions); i++ {
		for _, r := range reactions[i] {
			at := r.T + crowdDelay
			if at >= p.durations[i] {
				continue
			}
			_, length, _ := reactionShape(r.Score)
			length = math.Min(length, p.durations[i]-at+crowdSpill)
			out = append(out, crowdReact{at: starts[i] + at, score: r.Score, length: length, from: crowdLoud[n%len(crowdLoud)]})
			n++
		}
	}
	return out
}

// crowdSpill is how far a reaction may run into the next clip.
const crowdSpill = 1.0

// reactionShape is how a reaction of this score sounds: its gain, length
// and fade-out (a short "heeey", a cheer, a big "whoaaa").
func reactionShape(score float64) (gain, length, fall float64) {
	switch {
	case score >= reactWow:
		return wowGain, 4.6, 2.6
	case score >= reactCheer:
		return roarGain, 3.6, 2.0
	default:
		return heyGain, 2.2, 1.3
	}
}

func (c *partCrowd) has(part int) bool {
	if c == nil {
		return false
	}
	_, ok := c.bedIn[part]
	return ok
}

// crowdPart mixes part i's murmur into its sound ([a<i>raw] into [a<i>in]),
// within the clip so a crossfade or the wipe takes it along with the
// picture: it follows the clip's own sound (a gate the game opens, slow to
// close) and is slowed with the picture through the opening under the
// caption card. At the clip's end it stays at full speed.
func crowdPart(p reelPlan, i int) string {
	c := p.crowd
	d := p.durations[i]
	slow := math.Min(cardExit, d)
	in := c.bedIn[i]
	var b strings.Builder
	fmt.Fprintf(&b, "[a%draw]asplit=2[a%dgame][a%dside];", i, i, i)
	fmt.Fprintf(&b, "[%d:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,asplit=2[cs%d][cn%d];", in, i, i)
	fmt.Fprintf(&b, "[cs%d]atrim=duration=%.3f,asetrate=%d,aresample=48000,asetpts=PTS-STARTPTS[cso%d];",
		i, slow*slowmoSpeed, int(math.Round(48000*slowmoSpeed)), i)
	fmt.Fprintf(&b, "[cn%d]atrim=start=%.3f,asetpts=PTS-STARTPTS[cnr%d];", i, slow*slowmoSpeed, i)
	fmt.Fprintf(&b, "[cso%d][cnr%d]concat=n=2:v=0:a=1,apad,atrim=duration=%.3f,volume=%g[cb%d];", i, i, d, crowdBedGain, i)
	fmt.Fprintf(&b, "[cb%d][a%dside]sidechaingate=threshold=%g:ratio=8:attack=120:release=2200:range=%g:knee=3:detection=rms[bed%d];",
		i, i, crowdGateThreshold, crowdGateRange, i)
	fmt.Fprintf(&b, "[a%dgame][bed%d]amix=inputs=2:duration=first:normalize=0[a%din];", i, i, i)
	return b.String()
}

// reactFilter is the reactions' part of the final mix: each input faded and
// placed at its time, as one [reacts] stream; "" without reactions.
func reactFilter(reacts []crowdReact) string {
	if len(reacts) == 0 {
		return ""
	}
	var b strings.Builder
	var labels []string
	for j, r := range reacts {
		gain, _, fall := reactionShape(r.score)
		fall = math.Min(fall, r.length)
		fmt.Fprintf(&b, ";[%d:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,afade=t=in:d=0.25,afade=t=out:st=%.3f:d=%.3f,volume=%g,adelay=%d:all=1[react%d]",
			r.in, math.Max(0, r.length-fall), fall, gain, int(math.Round(r.at*1000)), j)
		labels = append(labels, fmt.Sprintf("[react%d]", j))
	}
	if len(labels) == 1 {
		fmt.Fprintf(&b, ";%sanull[reacts]", labels[0])
	} else {
		fmt.Fprintf(&b, ";%samix=inputs=%d:duration=longest:normalize=0[reacts]", strings.Join(labels, ""), len(labels))
	}
	return b.String()
}
