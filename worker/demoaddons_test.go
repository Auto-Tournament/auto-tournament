package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// fakeDemo is a demo's start as a CS2 server writes it (header fields 1, 10
// addons and 11) and a tail the two offsets point into.
func fakeDemo(addons string) []byte {
	field := func(n int, s string) []byte {
		return append(append([]byte{byte(n<<3 | 2)}, binary.AppendUvarint(nil, uint64(len(s)))...), s...)
	}
	payload := append(append(field(1, "PBDEMS2\x00"), field(headerAddons, addons)...), field(11, "valve_demo_2")...)
	frame := append([]byte{demFileHeader, 0xff, 0xff, 0xff, 0xff, 0x0f}, binary.AppendUvarint(nil, uint64(len(payload)))...)
	frame = append(frame, payload...)
	tail := []byte("frames...SPAWN...INFO")
	head := append([]byte{}, demoMagic...)
	start := 16 + len(frame)
	head = binary.LittleEndian.AppendUint32(head, uint32(start+bytes.Index(tail, []byte("INFO"))))
	head = binary.LittleEndian.AppendUint32(head, uint32(start+bytes.Index(tail, []byte("SPAWN"))))
	return append(append(head, frame...), tail...)
}

func copied(t *testing.T, demo []byte) []byte {
	dir := t.TempDir()
	from, to := filepath.Join(dir, "in.dem"), filepath.Join(dir, "out.dem")
	if err := os.WriteFile(from, demo, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := copyDemoWithoutAddons(from, to); err != nil {
		t.Fatal(err)
	}
	out, err := os.ReadFile(to)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDemoAddonsEmptied(t *testing.T) {
	out := copied(t, fakeDemo("3827905393"))
	// Exactly what a server without the addon writes, offsets included.
	if want := fakeDemo(""); !bytes.Equal(out, want) {
		t.Fatalf("got\n%q\nwant\n%q", out, want)
	}
	for _, at := range []int{8, 12} {
		off := binary.LittleEndian.Uint32(out[at:])
		if word := string(out[off : off+4]); word != "INFO" && word != "SPAW" {
			t.Fatalf("offset at %d points at %q", at, word)
		}
	}
}

func TestDemoWithoutAddonsCopiedAsIs(t *testing.T) {
	for _, demo := range [][]byte{fakeDemo(""), []byte("not a demo at all"), {}} {
		if out := copied(t, demo); !bytes.Equal(out, demo) {
			t.Fatalf("changed %q to %q", demo, out)
		}
	}
}
