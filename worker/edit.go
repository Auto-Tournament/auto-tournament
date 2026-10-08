package main

import (
	"fmt"
	"image"
	"math"
	"os"
	"strconv"
	"strings"
)

// The highlight edit: the clip plays at full speed until the last enemy dies,
// then slows step by step to slowmoSpeed (about a second of video), holds
// there for about another second and cuts while still slowed: once the
// killing is done there is nothing to speed back up for.
const (
	slowmoSpeed = 0.5
	rampSec     = 0.75 // game seconds slowing down from the kill (≈1 s of video)
	holdSec     = 0.5  // game seconds held at slowmoSpeed (1 s of video)
	afterUpSec  = 0.5  // then game seconds speeding back up to full speed
	afterSec    = 0.8  // and game seconds at full speed before the cut
	rampSteps   = 8    // a ramp is this many constant-speed pieces
	// tailSec is how much game after the last kill a clip shows.
	tailSec = rampSec + holdSec + afterUpSec + afterSec
)

// The frame rate and height (16:9) of every clip and reel: 1080p at 60 fps,
// or what AT_OUTPUT_FPS and AT_OUTPUT_HEIGHT say (a pro showcase at 1440p120).
var (
	outputFPS    = float64(envPositive("AT_OUTPUT_FPS", 60))
	outputHeight = envPositive("AT_OUTPUT_HEIGHT", 1080) &^ 1
	// nvencPreset is NVENC's speed/quality trade (p1 fastest … p7 best;
	// AT_NVENC_PRESET): the rate control holds the quality (-cq), so the
	// fastest costs file size, not looks.
	nvencPreset = env("AT_NVENC_PRESET", "p1")
)

// outputSize is a clip's width and height (16:9 at outputHeight).
func outputSize() (int, int) {
	return (outputHeight * 16 / 9) &^ 1, outputHeight
}

// renderHeight is the height CS2 renders at for a clip `out` tall:
// AT_RENDER_SCALE of it (default 1, the clip's own size), scaled up
// afterwards. At 2/3 (720p for 1080p) the 3060 has the headroom to pace
// frames evenly; the card and kill feed are drawn at the clip's size either way.
func renderHeight(out int) int {
	scale := 1.0
	if v, err := strconv.ParseFloat(os.Getenv("AT_RENDER_SCALE"), 64); err == nil && v > 0.2 && v <= 1 {
		scale = v
	}
	return int(math.Round(float64(out)*scale)) &^ 1
}

func envPositive(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}

// segment is a piece of the recording (seconds from its start) played at one speed.
type segment struct {
	From, To, Speed float64
}

// introUpSec is how long (in video seconds) a clip that opened slowed down
// takes to get back to full speed, from when its caption card starts to leave.
const introUpSec = 0.6

// introGame is how much game the slowed opening shows: `hold` at
// slowmoSpeed until the card leaves (cardExit), then `up` speeding back up.
func introGame() (hold, up float64) {
	inv := 0.0
	for i := 0; i < rampSteps; i++ {
		inv += 1 / upSpeed(i)
	}
	return cardExit * slowmoSpeed, introUpSec / inv * rampSteps
}

// upSpeed is the opening's i-th step back up to full speed (none of them
// at slowmoSpeed itself, so the hold ends exactly as the card leaves).
func upSpeed(i int) float64 {
	return math.Round((slowmoSpeed+(1-slowmoSpeed)*float64(i+1)/(rampSteps+1))*1000) / 1000
}

func stepSpeed(i int) float64 {
	return math.Round((1+(slowmoSpeed-1)*float64(i+1)/rampSteps)*1000) / 1000
}

// speedRamp cuts a recording of `length` seconds into pieces: full speed to
// `kill` seconds in, slowing to slowmoSpeed, held there, then back up to full
// speed for the round's last moment before the cut.
func speedRamp(length, kill float64) []segment {
	return editPlan(length, false, kill)
}

// editPlan is speedRamp with, when `intro`, the opening slowed down while
// the caption card is up and back to full speed as it leaves; and with no
// slow motion at the end when kill < 0.
func editPlan(length float64, intro bool, kill float64) []segment {
	var out []segment
	add := func(from, to, speed float64) {
		from, to = math.Max(0, from), math.Min(length, to)
		if to-from < 1e-6 {
			return
		}
		if n := len(out); n > 0 && out[n-1].Speed == speed && math.Abs(out[n-1].To-from) < 1e-6 {
			out[n-1].To = to
			return
		}
		out = append(out, segment{from, to, speed})
	}
	start := 0.0
	if intro {
		hold, up := introGame()
		// It has to be over before the slow motion at the end (or the clip's end).
		limit := length
		if kill >= 0 {
			limit = kill
		}
		if f := math.Min(1, (limit-0.2)/(hold+up)); f > 0.25 {
			hold, up = hold*f, up*f
			add(0, hold, slowmoSpeed)
			for i := 0; i < rampSteps; i++ {
				add(hold+float64(i)*up/rampSteps, hold+float64(i+1)*up/rampSteps, upSpeed(i))
			}
			start = hold + up
		}
	}
	if kill < 0 {
		add(start, length, 1)
		return out
	}
	// Slowing down step by step from the kill, held slowed, then back up to
	// full speed so the game plays on a moment before the cut.
	step := rampSec / rampSteps
	add(start, kill, 1)
	for i := 0; i < rampSteps; i++ {
		add(kill+float64(i)*step, kill+float64(i+1)*step, stepSpeed(i))
	}
	up := kill + rampSec + holdSec
	add(kill+rampSec, up, slowmoSpeed)
	upStep := afterUpSec / rampSteps
	for i := 0; i < rampSteps; i++ {
		add(up+float64(i)*upStep, up+float64(i+1)*upStep, upSpeed(i))
	}
	add(up+afterUpSec, length, 1)
	return out
}

// outputAt is where `t` seconds of the recording land in the edited clip.
func outputAt(segs []segment, t float64) float64 {
	total := 0.0
	for _, s := range segs {
		if t <= s.From {
			break
		}
		total += (math.Min(t, s.To) - s.From) / s.Speed
	}
	return total
}

// clipMarkers is where a clip's kills and slow motion are, in seconds of the
// video: the site's player marks them on its scrubber.
type clipMarkers struct {
	Duration float64     `json:"duration"`
	Kills    []float64   `json:"kills"`
	Slowmo   *[2]float64 `json:"slowmo"`
	// Reactions are the kills the crowd reacts to (cheers.go), among Kills,
	// with how impressive each was.
	Reactions []reaction `json:"reactions,omitempty"`
}

// momentMarkers works out a moment's markers from its windows (in order) and
// each window's edit.
func momentMarkers(windows []window, segs [][]segment, killTicks []int) clipMarkers {
	m := clipMarkers{Kills: []float64{}}
	round := func(v float64) float64 { return math.Round(v*100) / 100 }
	offset := 0.0
	for i, w := range windows {
		for _, k := range killTicks {
			if k >= w.from && k <= w.to {
				m.Kills = append(m.Kills, round(offset+outputAt(segs[i], float64(k-w.from)/tickrate)))
			}
		}
		// The slow motion after the last kill (a slowed opening is not it).
		first, last := -1, -1
		for j, s := range segs[i] {
			if w.slowmo >= 0 && s.Speed < 1 && s.From >= float64(w.slowmo-w.from)/tickrate-1e-6 {
				if first < 0 {
					first = j
				}
				last = j
			}
		}
		if first >= 0 {
			m.Slowmo = &[2]float64{
				round(offset + outputAt(segs[i], segs[i][first].From)),
				round(offset + outputAt(segs[i], segs[i][last].To)),
			}
		}
		offset += outputSeconds(segs[i])
		if i < len(windows)-1 {
			// The pieces blend into each other (reelCrossfade).
			offset -= reelCrossfade
		}
	}
	m.Duration = round(offset)
	return m
}

// outputSeconds is how long the edited clip runs.
func outputSeconds(segs []segment) float64 {
	total := 0.0
	for _, s := range segs {
		total += (s.To - s.From) / s.Speed
	}
	return total
}

// audioFilter plays the moment's sound [1:a] (from its start, `length`
// seconds) piece by piece at each piece's speed, the way a record slows down:
// the pitch drops with the speed and comes back with it. Output [a].
func audioFilter(segs []segment, length float64) string {
	var b strings.Builder
	n := len(segs)
	fmt.Fprintf(&b, "[1:a]atrim=duration=%.4f,asetpts=PTS-STARTPTS,aresample=48000,asplit=%d", length, n)
	for i := range segs {
		fmt.Fprintf(&b, "[t%d]", i)
	}
	b.WriteString(";")
	for i, s := range segs {
		fmt.Fprintf(&b, "[t%d]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS", i, s.From, s.To)
		if math.Abs(s.Speed-1) > 1e-6 {
			fmt.Fprintf(&b, ",asetrate=%d,aresample=48000", int(math.Round(48000*s.Speed)))
		}
		fmt.Fprintf(&b, "[a%d];", i)
	}
	for i := range segs {
		fmt.Fprintf(&b, "[a%d]", i)
	}
	fmt.Fprintf(&b, "concat=n=%d:v=0:a=1[a]", n)
	return b.String()
}

// overlay is what goes on top of a clip's frames ([0:v]).
type overlay struct {
	card   int // input holding the caption card's frames (card.go: raw premultiplied RGBA at cardFPS), or -1
	cardAt image.Point
	feed   int             // input holding the kill feed's frames (killfeed.go, like the card's), or -1
	feedAt image.Rectangle // where the kill feed goes, the size of its frames
	logo   int             // input holding the Auto Tournament logo, looped, or -1
	width  int
	height int
	// clean: the frames also come out undressed as [clean] (the clean twin, overlay.go).
	clean bool
}

// videoFilter dresses the frames: the animated caption card for the first
// seconds, and the logo small and faint in the lower right throughout (the
// top right is the kill feed's). Output [v].
func videoFilter(o overlay) string {
	var b strings.Builder
	// The game, captured smaller (720p for a 1080p clip: CS2 then has the
	// headroom to pace its frames evenly), scaled up to the clip's size; the
	// card and kill feed are drawn at that size, sharp.
	fmt.Fprintf(&b, "[0:v]scale=%d:%d:flags=lanczos,format=yuv420p", o.width, o.height)
	if o.clean {
		b.WriteString(",split[base][clean]")
	} else {
		b.WriteString("[base]")
	}
	last := "base"
	if o.card >= 0 {
		fmt.Fprintf(&b, ";[%s][%d:v]overlay=%d:%d:eof_action=repeat:alpha=premultiplied[withcard]", last, o.card, o.cardAt.X, o.cardAt.Y)
		last = "withcard"
	}
	if o.feed >= 0 {
		// Like CS2's death notices, the game blurs a little behind each row's
		// plate: the feed's own alpha, stretched so a plate is fully covered,
		// masks a blurred copy of the frame under it.
		r := o.feedAt
		fmt.Fprintf(&b, ";[%s]split[under][behind]", last)
		fmt.Fprintf(&b, ";[%d:v]split[feed][feedmask]", o.feed)
		fmt.Fprintf(&b, ";[behind]crop=%d:%d:%d:%d,format=rgba,gblur=sigma=%.1f:steps=2[blurred]", r.Dx(), r.Dy(), r.Min.X, r.Min.Y, feedBlurSigma*float64(o.height)/1080)
		fmt.Fprintf(&b, ";[feedmask]colorchannelmixer=aa=%.4f,alphaextract[mask]", 255.0/feedPlateOtherAlpha)
		b.WriteString(";[blurred][mask]alphamerge[frosted]")
		fmt.Fprintf(&b, ";[under][frosted]overlay=%d:%d:eof_action=repeat[withblur]", r.Min.X, r.Min.Y)
		fmt.Fprintf(&b, ";[withblur][feed]overlay=%d:%d:eof_action=repeat:alpha=premultiplied[withfeed]", r.Min.X, r.Min.Y)
		last = "withfeed"
	}
	if o.logo >= 0 {
		// The drafts: 16 px tall, 18 px from the right and 16 from the bottom of 540, at 30 %.
		size := o.height * 16 / 540 &^ 1
		fmt.Fprintf(&b, ";[%d:v]scale=%d:%d,format=rgba,colorchannelmixer=aa=0.3[logo]"+
			";[%s][logo]overlay=W-w-%d:H-h-%d:shortest=1", o.logo, size, size, last, o.height*18/540, o.height*16/540)
	} else {
		fmt.Fprintf(&b, ";[%s]null", last)
	}
	b.WriteString(",format=yuv420p[v]")
	return b.String()
}

// reelCrossfade is how long one part blends into the next (picture and
// sound): a player's kills inside a clip, and one player's clips in a row.
// The next player comes in behind the orange wipe instead (reel.go).
const reelCrossfade = 0.4

// encodeArgs are the output settings every piece and the reel share, so the
// pieces can be joined without re-encoding.
//
// H.264 in MP4, 1080p at 60 fps: it plays everywhere a clip is shared,
// Discord's player and Firefox included, which H.265 did not (a frozen
// frame on Discord; Firefox has no H.265 at all). Captured at 120 fps and
// 1440p, so the slow motion keeps a real frame for each frame shown; the file
// people watch is 1080p60, about half the size of the H.265 1440p120 one.
// H.265 stays available with AT_ENCODER=hevc_nvenc or libx265.
func encodeArgs(encoder string) []string {
	args := []string{"-c:v", encoder, "-r", fmt.Sprint(outputFPS), "-g", fmt.Sprint(2 * outputFPS),
		"-s", fmt.Sprintf("%dx%d", outputHeight*16/9, outputHeight), "-sws_flags", "lanczos"}
	switch encoder {
	case "libx265":
		args = append(args, "-preset", "fast", "-crf", "24", "-tag:v", "hvc1", "-x265-params", "log-level=error")
	case "hevc_nvenc":
		args = append(args, "-preset", nvencPreset, "-tune", "hq", "-rc", "vbr", "-cq", "26", "-b:v", "0", "-tag:v", "hvc1")
	case "libx264":
		args = append(args, "-preset", "fast", "-crf", "21", "-profile:v", "high", "-pix_fmt", "yuv420p")
	default: // h264_nvenc
		args = append(args, "-preset", nvencPreset, "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "0",
			"-maxrate", "16M", "-bufsize", "32M", "-profile:v", "high", "-pix_fmt", "yuv420p")
	}
	return append(args, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2")
}
