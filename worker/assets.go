package main

import _ "embed"

// watermarkPNG is the Auto Tournament wordmark (light, for video), shown
// faintly in the lower right of every clip unless the platform's admin turned
// it off.
//
//go:embed assets/watermark.png
var watermarkPNG []byte
