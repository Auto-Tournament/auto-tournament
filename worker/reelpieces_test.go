package main

import (
	"math"
	"strings"
	"testing"
)

// The pieces add up to the reel reelFilter makes, frame for frame, and each
// join takes exactly its overlap from the parts on either side.
func TestReelPiecesAddUpToTheReel(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 9.73, 8.2, 11.05}, joins: []join{joinWipe, joinFade, joinWipe},
		width: 3840, height: 2160, fps: 240, outro: true}
	pieces := reelPieces(p)
	total, frames := 0.0, 0
	for _, pc := range pieces {
		total += pc.length
		frames += pc.frames
	}
	if math.Abs(total-reelLength(p)) > 1e-9 {
		t.Fatalf("pieces run %.4f s, the reel %.4f s", total, reelLength(p))
	}
	if want := int(math.Round(reelLength(p) * p.fps)); frames != want {
		t.Fatalf("pieces have %d frames, the reel %d", frames, want)
	}
	// part 0, wipe, part 1, fade, part 2, wipe, part 3
	if len(pieces) != 7 || pieces[1].b != 1 || pieces[1].join != joinWipe || pieces[3].join != joinFade {
		t.Fatalf("pieces = %+v", pieces)
	}
	if pieces[2].from != wipeInSec || pieces[2].length != 9.73-wipeInSec-reelCrossfade {
		t.Fatalf("part 1 = %+v", pieces[2])
	}
	if pieces[3].from != 9.73-reelCrossfade {
		t.Fatalf("the fade starts at %.3f into part 1", pieces[3].from)
	}
}

// The first piece fades in, the last holds and fades out, a wipe goes through the orange bar.
func TestPieceFilters(t *testing.T) {
	p := reelPlan{durations: []float64{4.4, 9.73}, joins: []join{joinWipe}, width: 1920, height: 1080, fps: 120, outro: true}
	pieces := reelPieces(p)
	if f := pieceFilter(p, pieces[0], true, false); !strings.Contains(f, "fade=t=in") || strings.Contains(f, "tpad") {
		t.Fatalf("first: %s", f)
	}
	if f := pieceFilter(p, pieces[1], false, false); !strings.Contains(f, "0xff6a3d") || strings.Count(f, "xfade=transition=wiperight") != 2 {
		t.Fatalf("wipe: %s", f)
	}
	if f := pieceFilter(p, pieces[2], false, true); !strings.Contains(f, "tpad=stop_mode=clone") || !strings.Contains(f, "fade=t=out") {
		t.Fatalf("last: %s", f)
	}
}
