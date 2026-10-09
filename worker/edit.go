package main

import (
	"fmt"
	"image"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
)

// The highlight edit: the clip plays at full speed until the last enemy dies,
// then slows step by step to slowmoSpeed (about a second of video) and stays
// slowed to the cut (2.5 s of video): once the killing is done there is
// nothing to speed back up for (speeding up again read as the clip running
// away, 2026-10-08).
const (
	slowmoSpeed = 0.5
	rampSec     = 0.75 // game seconds slowing down from the kill (≈1 s of video)
	holdSec     = 1.25 // game seconds held at slowmoSpeed to the cut (2.5 s of video)
	rampSteps   = 8    // a ramp is this many constant-speed pieces
	// tailSec is how much game after the last kill a clip shows.
	tailSec = rampSec + holdSec
)

// The frame rate and height (16:9) of every clip and reel: 1080p at 60 fps,
// or what AT_OUTPUT_FPS and AT_OUTPUT_HEIGHT say (a pro showcase at 1440p120).
var (
	outputFPS    = float64(envPositive("AT_OUTPUT_FPS", 60))
	outputHeight = envPositive("AT_OUTPUT_HEIGHT", 1080) &^ 1
	// nvencPreset is NVENC's speed/quality trade (p1 fastest … p7 best;
	// AT_NVENC_PRESET): the rate control holds the quality (-cq), so the
	// fastest costs file size, not looks.
	nvencPreset = env("AT_NVENC_PRESET", "p7")
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

// introGameGain is the game's sound under the caption card's entrance: a
// little down, so the card has the moment, and back up as the game does.
const introGameGain = 0.5

// introMuffleHz is the low-pass the game's sound goes through under it, as
// the picture is blurred.
const introMuffleHz = 900

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
// `kill` seconds in, then slowing to slowmoSpeed and slowed to the cut.
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
	add(kill+rampSec, length, slowmoSpeed)
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

// tickAt is where a demo tick lands in a moment's clip (its windows and
// each window's edit), or -1 when no window holds it.
func tickAt(windows []window, segs [][]segment, tick int) float64 {
	offset := 0.0
	for i, w := range windows {
		if tick >= w.from && tick <= w.to {
			return offset + outputAt(segs[i], float64(tick-w.from)/tickrate)
		}
		offset += outputSeconds(segs[i])
		if i < len(windows)-1 {
			offset -= reelCrossfade
		}
	}
	return -1
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
//
// focusAt >= 0: a caption card's entrance starts there (video seconds), and
// the game is at introGameGain under it, back to full as the game comes back
// into focus.
func audioFilter(segs []segment, length, focusAt float64) string {
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
	fmt.Fprintf(&b, "concat=n=%d:v=0:a=1", n)
	if focusAt < 0 {
		b.WriteString("[a]")
		return b.String()
	}
	// Muffled too while the picture is blurred: the sound through a low-pass,
	// crossfaded back to the clear sound as the game comes into focus.
	up := focusAt + focusOut
	w := fmt.Sprintf("if(lt(t,%.3f),1,if(lt(t,%.3f),1-(t-%.3f)/%.3f,0))", up, up+focusOutDur, up, focusOutDur)
	gain := fmt.Sprintf("(%g+%g*(1-%s))", introGameGain, 1-introGameGain, w)
	fmt.Fprintf(&b, ",asplit[gd][gw];[gw]lowpass=f=%d,volume='%s*%s':eval=frame[gm];[gd]volume='%s*(1-%s)':eval=frame[gc];"+
		"[gc][gm]amix=inputs=2:normalize=0:duration=first[a]", introMuffleHz, gain, w, gain, w)
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
	// focus: when (seconds into the video) a caption card's entrance starts:
	// the game behind it blurs and darkens while it is up (focusFilter).
	focus []float64
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
	if len(o.focus) > 0 {
		b.WriteString(";" + focusFilter("base", "focused", o.focus, o.width))
		last = "focused"
	}
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
	args := []string{"-c:v", encoder, "-r", fmt.Sprint(outputFPS), "-g", fmt.Sprint(2 * outputFPS)}
	if encoder != "h264_vaapi" { // VAAPI's frames are scaled before they go up to the GPU (hwEncode)
		args = append(args, "-s", fmt.Sprintf("%dx%d", outputHeight*16/9, outputHeight), "-sws_flags", "lanczos")
	}
	switch encoder {
	case "h264_vaapi":
		// AMD and Intel: quality-defined VBR with the same ceiling as NVENC.
		rate := maxBitrate()
		args = append(args, "-rc_mode", "QVBR", "-global_quality", env("AT_VAAPI_QUALITY", "18"), "-b:v", fmt.Sprintf("%dM", rate),
			"-maxrate", fmt.Sprintf("%dM", rate), "-bufsize", fmt.Sprintf("%dM", 2*rate), "-profile:v", "high")
	case "libx265":
		args = append(args, "-preset", "fast", "-crf", "24", "-tag:v", "hvc1", "-x265-params", "log-level=error")
	case "hevc_nvenc":
		args = append(args, "-preset", nvencPreset, "-tune", "hq", "-rc", "vbr", "-cq", "26", "-b:v", "0", "-tag:v", "hvc1")
	case "libx264":
		args = append(args, "-preset", "fast", "-crf", "21", "-profile:v", "high", "-pix_fmt", "yuv420p")
	default: // h264_nvenc
		// The ceiling grows with the pixels a second: 16 Mbit/s was set for
		// 1080p60, and 1440p120 (3.6 times the pixels) came out blocky at it.
		rate := maxBitrate()
		args = append(args, "-preset", nvencPreset, "-tune", "hq", "-rc", "vbr", "-cq", "17", "-b:v", "0",
			"-maxrate", fmt.Sprintf("%dM", rate), "-bufsize", fmt.Sprintf("%dM", 2*rate), "-profile:v", "high", "-level", "5.2", "-pix_fmt", "yuv420p")
	}
	return append(args, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2")
}

// vaapiDevice is the render node VAAPI encodes on (AT_VAAPI_DEVICE).
var vaapiDevice = env("AT_VAAPI_DEVICE", "/dev/dri/renderD128")

// hwEncode fits an ffmpeg command line to its encoder. For VAAPI it opens
// the GPU and sends each video output ([v], [clean]) through a scale to the
// output size and up to the GPU; other encoders take the frames as they are.
func hwEncode(args []string, encoder string) []string {
	if encoder != "h264_vaapi" {
		return args
	}
	out := []string{"-init_hw_device", "vaapi=va:" + vaapiDevice, "-filter_hw_device", "va"}
	fc := -1
	var up []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "-filter_complex" && i+1 < len(args) {
			fc = len(out) + 1
		}
		if a == "-map" && i+1 < len(args) && (args[i+1] == "[v]" || args[i+1] == "[clean]") {
			label := strings.Trim(args[i+1], "[]")
			up = append(up, fmt.Sprintf("[%s]scale=%d:%d:flags=lanczos,format=nv12,hwupload[%s_hw]", label, outputHeight*16/9, outputHeight, label))
			out = append(out, a, "["+label+"_hw]")
			i++
			continue
		}
		out = append(out, a)
	}
	if fc >= 0 && len(up) > 0 {
		out[fc] += ";" + strings.Join(up, ";")
	}
	return out
}

// The card's entrance (card.go): the game behind it goes out of focus as the
// card unfolds and comes back as it moves down. The drafts (2026-10-08):
// 16 px of blur on a 1152 px wide frame, darkened 80 % at the edges and
// about half in the middle.
const (
	focusIn      = 0.10 // the card starts to unfold
	focusInDur   = 0.65
	focusOut     = cardMove // it starts to move down
	focusOutDur  = 0.60
	focusBlurPx  = 16.0
	focusDraftW  = 1152.0
	focusShade   = 0.62 // the darkening, before the vignette darkens the edges more
	focusSeconds = focusOut + focusOutDur + 0.05
)

// focusFilter blurs and darkens [in] behind each card entrance starting at
// `at` seconds (a clip's, or each clip's in a reel) into [out].
//
// One effect branch runs beside the game the whole way: its blur, shade and
// vignette are on only in the windows (timeline `enable`), and the blend
// fades it in and out by its opacity, which sendcmd steps through each
// fade. Every frame flows straight through. (A branch per window that starts
// at its window made the joining overlay hold every frame until that window
// came: a reel's last card is near its end, and ffmpeg then kept a minute of
// 1440p frames in memory, ~30 GB.)
func focusFilter(in, out string, at []float64, width int) string {
	var on []string
	for _, a := range at {
		on = append(on, fmt.Sprintf("between(t,%.3f,%.3f)", a+focusIn, a+focusSeconds))
	}
	enable := strings.Join(on, "+")
	sigma := focusBlurPx * float64(width) / focusDraftW
	var b strings.Builder
	fmt.Fprintf(&b, "[%s]sendcmd=c='%s',split[%s_keep][%s_fx]", in, focusCommands(at), out, out)
	fmt.Fprintf(&b, ";[%s_fx]gblur=sigma=%.1f:enable='%s',drawbox=color=0x080504@%.2f:t=fill:enable='%s',vignette=angle=PI/4:enable='%s'[%s_fxd]",
		out, sigma, enable, focusShade, enable, enable, out)
	// normal blend: first*opacity + second*(1-opacity), so the game is the
	// first input at opacity 1 - the effect's strength; off it passes the game.
	fmt.Fprintf(&b, ";[%s_keep][%s_fxd]blend@focus=all_mode=normal:all_opacity=1:enable='%s'[%s]", out, out, enable, out)
	return b.String()
}

// focusStep is how often the effect's strength is set during a fade.
const focusStep = 1.0 / 60

// focusStrength is how strong the focus effect is `r` seconds after its
// card starts: up over focusInDur from focusIn, held, then down over
// focusOutDur from focusOut.
func focusStrength(r float64) float64 {
	switch {
	case r < focusIn || r >= focusOut+focusOutDur:
		return 0
	case r < focusIn+focusInDur:
		return (r - focusIn) / focusInDur
	case r < focusOut:
		return 1
	default:
		return 1 - (r-focusOut)/focusOutDur
	}
}

// focusCommands is the sendcmd script that fades the effect: at each step of
// every fade, the blend's opacity is 1 - the strongest window's strength.
func focusCommands(at []float64) string {
	var times []float64
	for _, a := range at {
		for r := focusIn; r <= focusSeconds+focusStep/2; r += focusStep {
			times = append(times, a+r)
		}
	}
	sort.Float64s(times)
	var cmds []string
	last := -1.0
	for _, t := range times {
		s := 0.0
		for _, a := range at {
			s = math.Max(s, focusStrength(t-a))
		}
		op := math.Round((1-s)*1000) / 1000
		if op == last {
			continue
		}
		last = op
		cmds = append(cmds, fmt.Sprintf("%.4f blend@focus all_opacity %.3f", t, op))
	}
	return strings.Join(cmds, ";")
}

// maxBitrate is the H.264 ceiling (Mbit/s) for the clip's size and frame
// rate: 24 at 1080p60, scaled by the pixels a second (85 at 1440p120), at
// most 150. Quality over size: the clips are shared and shown on big
// screens, and the GPU's encoder is nowhere near the bottleneck.
func maxBitrate() int {
	w, h := outputSize()
	scale := float64(w*h) * outputFPS / (1920 * 1080 * 60)
	return int(math.Min(150, math.Max(24, math.Round(24*scale))))
}
