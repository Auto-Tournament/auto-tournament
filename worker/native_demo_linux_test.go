//go:build linux

package main

import (
	"encoding/binary"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
	"google.golang.org/protobuf/proto"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeBootstrapReadsDemoMap(t *testing.T) {
	header, err := proto.Marshal(&msg.CDemoFileHeader{DemoFileStamp: proto.String("PBDEMS2"), MapName: proto.String("de_mirage"), PatchVersion: proto.Int32(14191)})
	if err != nil {
		t.Fatal(err)
	}
	data := append([]byte("PBDEMS2\x00"), make([]byte, 8)...)
	data = append(data, 1, 0) // DEM_FileHeader, tick 0
	var size [10]byte
	n := binary.PutUvarint(size[:], uint64(len(header)))
	data = append(data, size[:n]...)
	data = append(data, header...)
	path := filepath.Join(t.TempDir(), "match.dem")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := nativeDemoMap(path)
	if err != nil || got != "de_mirage" {
		t.Fatalf("map=%q, error=%v", got, err)
	}
}
