package main

import _ "embed"

// watermarkPNG is the Auto Tournament ram: the logo in the intro's "Played on
// Auto Tournament" and in the corner watermark of every clip (playedOnPNG),
// unless the platform's admin turned it off.
//
//go:embed assets/watermark.png
var watermarkPNG []byte
