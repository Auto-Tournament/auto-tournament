package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecordingClaimAdvertisesAttemptTokens(t *testing.T) {
	claims := 0
	completed := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/game/cs2/recorder/complete" {
			if r.Header.Get("X-AT-Claim") != "attempt-one" {
				t.Error("completion missing attempt token")
			}
			completed = true
			return
		}
		var ask struct {
			Version int `json:"version"`
		}
		if err := json.NewDecoder(r.Body).Decode(&ask); err != nil {
			t.Error(err)
		}
		if ask.Version < 8 {
			t.Errorf("protocol %d does not request attempt tokens", ask.Version)
		}
		claims++
		if claims == 1 {
			fmt.Fprint(w, `{"claimToken":"attempt-one","job":{"kind":"match_reel"}}`)
			return
		}
		if !completed {
			t.Error("next claim precedes completion")
		}
		if r.Header.Get("X-AT-Claim") != "" {
			t.Error("next claim retained stale attempt token")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	c := &client{base: srv.URL, http: srv.Client(), worker: "csrender1"}
	if _, _, _, err := c.claimRecording(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if token := c.claimToken.Load(); token == nil || *token != "attempt-one" {
		t.Fatal("claim token was not stored")
	}
	if _, _, _, err := c.claimRecording(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
}
