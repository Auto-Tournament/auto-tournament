package main

import "testing"

func TestSteamLoggedOn(t *testing.T) {
	for log, want := range map[string]bool{
		"": false,
		"[2026-10-07 19:05:27] [Connecting, 4, 7] [U:1:4] Client thinks it can connect\n": false,
		"[2026-10-07 19:05:27] [Logging On, 4, 7] [U:1:4] Using JWT\n[2026-10-07 19:05:27] [Logged On, 4, 7] [U:1:4] RecvMsgClientLogOnResponse() : 'OK'\n[2026-10-07 19:05:27] CClientJobGetClientUpdateHosts: cached version not expired\n": true,
		"[2026-10-07 19:05:27] [Logged On, 4, 7] [U:1:4] ok\n[2026-10-07 20:00:00] [Logged Off, 4, 7] [U:1:4] bye\n":                                                                                                                          false,
	} {
		if got := steamLoggedOn(log); got != want {
			t.Errorf("steamLoggedOn(%q) = %v, want %v", log, got, want)
		}
	}
}

func TestSteamOfflineReady(t *testing.T) {
	offline := "[2026-10-08 21:53:35] Connectivity test: result=Connected\n" +
		"[2026-10-08 21:53:41] [Logged Off, 0, 0] [U:1:436588963] CCMInterface::SetSteamID( [U:1:436588963] )\n" +
		"[2026-10-08 21:53:41] [Logged Off, 0, 0] [U:1:436588963] LogOff()\n" +
		"[2026-10-08 21:53:41] [Logged Off, 0, 0] [U:1:436588963] CCMInterface::SetSteamID( [U:1:436588963] )\n"
	if !steamOfflineReady(offline) {
		t.Fatal("offline Steam with its account set is ready")
	}
	if steamOfflineReady("[2026-10-07 20:00:00] [Logged Off, 4, 7] [U:1:4] LogOff()\n") {
		t.Fatal("a plain log off is not")
	}
	if steamOfflineReady("") {
		t.Fatal("no log is not")
	}
}
