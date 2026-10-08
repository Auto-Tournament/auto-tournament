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
	crowdOut  string       // where the crowd track goes (buildCrowdTrack); none without it
	outro     bool         // a reel's ending: the last frame held, then a fade out
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

// crowdTrackPath is where a reel's crowd track goes: next to it.
func crowdTrackPath(reel string) string {
	return strings.TrimSuffix(reel, ".mp4") + ".crowd.m4a"
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

// reactionRate is how fast a reaction plays (1: as recorded): from 0.9 for
// the biggest to 1.1 for a small one, varied by where it falls so two alike
// do not match. Deterministic: the same reel sounds the same when made again.
func reactionRate(r crowdReact) float64 {
	base := 1.04
	switch {
	case r.score >= reactWow:
		base = 0.93
	case r.score >= reactCheer:
		base = 0.98
	}
	jitter := math.Mod(r.at*7.31+r.from*3.17, 1) - 0.5 // -0.5 … 0.5
	return math.Round((base+jitter*0.1)*1000) / 1000
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
	if p.crowdOnly {
		// The crowd track: the murmur alone, the game only opened it.
		fmt.Fprintf(&b, "[a%dgame]anullsink;[bed%d]anull[a%din];", i, i, i)
		return b.String()
	}
	fmt.Fprintf(&b, "[a%dgame][bed%d]amix=inputs=2:duration=first:normalize=0[a%din];", i, i, i)
	return b.String()
}

// crowdBedFilter is one clip's murmur, [bed], `d` seconds: the crowd
// recording (input 1) slowed through the clip's slowed opening, opened by the
// clip's own sound (input 0, the gate's side chain). Each clip's is made on
// its own and the reel's joins them (buildCrowdTrack): with every clip and
// stretch of the recording in one graph, ffmpeg stalled at the first join
// and every crowd track stopped after about 20 s (2026-10-08).
func crowdBedFilter(d float64) string {
	slow := math.Min(cardExit, d)
	var b strings.Builder
	fmt.Fprintf(&b, "[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration=%.3f[side];", d)
	b.WriteString("[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,asplit=2[cs][cn];")
	fmt.Fprintf(&b, "[cs]atrim=duration=%.3f,asetrate=%d,aresample=48000,asetpts=PTS-STARTPTS[cso];",
		slow*slowmoSpeed, int(math.Round(48000*slowmoSpeed)))
	fmt.Fprintf(&b, "[cn]atrim=start=%.3f,asetpts=PTS-STARTPTS[cnr];", slow*slowmoSpeed)
	fmt.Fprintf(&b, "[cso][cnr]concat=n=2:v=0:a=1,apad,atrim=duration=%.3f,volume=%g[cb];", d, crowdBedGain)
	fmt.Fprintf(&b, "[cb][side]sidechaingate=threshold=%g:ratio=8:attack=120:release=2200:range=%g:knee=3:detection=rms[bed]",
		crowdGateThreshold, crowdGateRange)
	return b.String()
}

// crowdReactsFilter lays the reactions (inputs from 1 on) over the murmur
// (input 0) into [crowd].
func crowdReactsFilter(reacts []crowdReact) string {
	if len(reacts) == 0 {
		return "[0:a]anull[crowd]"
	}
	return strings.TrimPrefix(reactFilter(reacts), ";") + ";[0:a][reacts]amix=inputs=2:duration=first:normalize=0[crowd]"
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
		// Played a little faster or slower (and so higher or lower), so the
		// same recording does not sound the same twice: bigger reactions a
		// touch lower, like a bigger crowd.
		rate := reactionRate(r)
		length := r.length / rate
		fall = math.Min(fall, length)
		fmt.Fprintf(&b, ";[%d:a]aresample=48000,aformat=channel_layouts=stereo,asetrate=%d,aresample=48000,asetpts=PTS-STARTPTS,"+
			"afade=t=in:d=0.25,afade=t=out:st=%.3f:d=%.3f,volume=%g,adelay=%d:all=1[react%d]",
			r.in, int(math.Round(48000*rate)), math.Max(0, length-fall), fall, gain, int(math.Round(r.at*1000)), j)
		labels = append(labels, fmt.Sprintf("[react%d]", j))
	}
	if len(labels) == 1 {
		fmt.Fprintf(&b, ";%sanull[reacts]", labels[0])
	} else {
		fmt.Fprintf(&b, ";%samix=inputs=%d:duration=longest:normalize=0[reacts]", strings.Join(labels, ""), len(labels))
	}
	return b.String()
}
