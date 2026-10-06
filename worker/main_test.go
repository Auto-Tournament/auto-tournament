package main

import "testing"

func TestFirstToken(t *testing.T) {
	for raw, want := range map[string]string{
		"":                            "",
		"abc123":                      "abc123",
		"bot:abc123,other:def":        "abc123",
		"  ; worker:s3cret ; x:y":     "s3cret",
		"label:part:with:colons,next": "part:with:colons",
	} {
		if got := firstToken(raw); got != want {
			t.Errorf("firstToken(%q) = %q, want %q", raw, got, want)
		}
	}
}
