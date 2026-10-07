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
