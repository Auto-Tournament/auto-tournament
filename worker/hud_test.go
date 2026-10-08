package main

import "testing"

func TestSvgFromResource(t *testing.T) {
	data := []byte("\x00\x01RED2junk<?xml version=\"1.0\"?>\n<svg viewBox=\"0 0 32 32\"><path d=\"M0 0\"/></svg>\x00trailing")
	svg, ok := svgFromResource(data)
	if !ok || string(svg) != "<?xml version=\"1.0\"?>\n<svg viewBox=\"0 0 32 32\"><path d=\"M0 0\"/></svg>" {
		t.Fatalf("svg = %q, %v", svg, ok)
	}
	if _, ok := svgFromResource([]byte("no svg here")); ok {
		t.Fatal("found an svg in nothing")
	}
}
