package main

import _ "embed"

// watermarkPNG is the Auto Tournament wordmark (light, for video), shown in
// the top right as a clip starts unless the platform's admin turned it off.
//
//go:embed assets/watermark.png
var watermarkPNG []byte
