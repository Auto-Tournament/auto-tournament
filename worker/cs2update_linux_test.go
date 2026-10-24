package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCS2UpToDateAsksSteamWithTheVersionsDigits(t *testing.T) {
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.Query().Get("version")
		if asked == "14192" {
			w.Write([]byte(`{"response":{"success":true,"up_to_date":true}}`))
			return
		}
		w.Write([]byte(`{"response":{"success":true,"up_to_date":false,"required_version":14192,"message":"Server version required: 1.41.9.2"}}`))
	}))
	defer srv.Close()
	defer func(u string) { steamUpToDateURL = u }(steamUpToDateURL)
	steamUpToDateURL = srv.URL + "/?appid=730&version="

	ok, want, err := cs2UpToDate(context.Background(), "1.41.8.9")
	if err != nil || ok || want != "1.41.9.2" || asked != "14189" {
		t.Fatalf("behind: ok=%v want=%q err=%v asked=%q", ok, want, err, asked)
	}
	if ok, _, err := cs2UpToDate(context.Background(), "1.41.9.2"); err != nil || !ok {
		t.Fatalf("current: ok=%v err=%v", ok, err)
	}
}

func TestSetSteamOfflineTogglesOnlyThatValue(t *testing.T) {
	users := filepath.Join(t.TempDir(), "loginusers.vdf")
	vdf := "\"users\"\n{\n\t\"7656\"\n\t{\n\t\t\"WantsOfflineMode\"\t\t\"1\"\n\t\t\"SkipOfflineModeWarning\"\t\t\"1\"\n\t}\n}\n"
	if err := os.WriteFile(users, []byte(vdf), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := setSteamOffline(users, false); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(users)
	if !strings.Contains(string(b), "\"WantsOfflineMode\"\t\t\"0\"") || !strings.Contains(string(b), "\"SkipOfflineModeWarning\"\t\t\"1\"") {
		t.Fatalf("online:\n%s", b)
	}
	if err := setSteamOffline(users, true); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(users); string(b) != vdf {
		t.Fatalf("offline again:\n%s", b)
	}
}
