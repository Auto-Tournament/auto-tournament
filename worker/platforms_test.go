package main

import "testing"

func TestPlatformsTakesHomeThenTheOthers(t *testing.T) {
	home := &client{base: "https://a.example.com", token: "atr_a", worker: "rig"}
	got := platforms(home, " https://b.example.com/ | atr_b ,bad-entry, https://a.example.com|atr_x ,https://c.example.com|")
	if len(got) != 2 || got[0] != home {
		t.Fatalf("want home and b, got %d", len(got))
	}
	if b := got[1]; b.base != "https://b.example.com" || b.token != "atr_b" || b.worker != "rig" {
		t.Fatalf("b: %+v", b)
	}
	if len(platforms(home, "")) != 1 {
		t.Fatal("no extra platforms: home alone")
	}
}
