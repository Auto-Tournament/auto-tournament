package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func archiveForTest(t *testing.T, kind byte, duplicate bool) ([]byte, string) {
	t.Helper()
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tr := tar.NewWriter(gz)
	payload := []byte{0x7f, 'E', 'L', 'F', 1, 2, 3}
	for i := 0; i < 1+map[bool]int{true: 1}[duplicate]; i++ {
		h := &tar.Header{Name: "at-recorder", Typeflag: kind, Mode: 0755, Size: int64(len(payload))}
		if kind == tar.TypeSymlink {
			h.Size = 0
			h.Linkname = "/etc/passwd"
		}
		if err := tr.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if h.Size > 0 {
			tr.Write(payload)
		}
	}
	tr.Close()
	gz.Close()
	sum := sha256.Sum256(b.Bytes())
	return b.Bytes(), hex.EncodeToString(sum[:])
}
func TestBinaryArchiveIntegrityAndPathSafety(t *testing.T) {
	b, checksum := archiveForTest(t, tar.TypeReg, false)
	if _, err := unpackBinary(b, checksum); err != nil {
		t.Fatal(err)
	}
	b[len(b)-1] ^= 1
	if _, err := unpackBinary(b, checksum); err == nil {
		t.Fatal("modified archive accepted")
	}
	for _, test := range []struct {
		kind      byte
		duplicate bool
	}{{tar.TypeSymlink, false}, {tar.TypeReg, true}} {
		b, checksum = archiveForTest(t, test.kind, test.duplicate)
		if _, err := unpackBinary(b, checksum); err == nil {
			t.Fatal("unsafe binary member accepted")
		}
	}
	req := updateRequest{AgentVersion: "0.1.0-beta.2", AgentSHA: checksum, AgentURL: "https://github.com/Auto-Tournament/auto-tournament/releases/download/at-recorder-v0.1.0-beta.2/at-recorder-linux-amd64.tar.gz"}
	if !validBinaryTarget(req) {
		t.Fatal("official versioned binary rejected")
	}
	req.AgentURL = "https://example.com/at-recorder"
	if validBinaryTarget(req) {
		t.Fatal("arbitrary binary URL accepted")
	}
}
func TestLauncherRestoresAgentThatCannotStart(t *testing.T) {
	root := t.TempDir()
	put := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0755); err != nil {
			t.Fatal(err)
		}
	}
	put("agent-launcher.sh", agentLauncher)
	put("at-recorder", "#!/bin/sh\nexit 12\n")
	put(".previous-agent", "#!/bin/sh\nprintf restored > recovered\nexit 0\n")
	put(".update.json", "{}")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", filepath.Join(root, "agent-launcher.sh"))
	cmd.Env = append(os.Environ(), "AT_RECORDER_ROOT="+root)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("launcher: %v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(root, "recovered")); err != nil {
		t.Fatal("previous agent did not run")
	}
	if _, err := os.Stat(filepath.Join(root, ".agent-rollback")); err != nil {
		t.Fatal("runtime recovery marker missing")
	}
}
func TestLauncherHandlesVerifiedBinaryHandoff(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "agent-launcher.sh"), []byte(agentLauncher), 0755)
	script := "#!/bin/sh\nif [ ! -f restarted ]; then touch restarted; exit 85; fi\nprintf finished > healthy\nexit 0\n"
	os.WriteFile(filepath.Join(root, "at-recorder"), []byte(script), 0755)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", filepath.Join(root, "agent-launcher.sh"))
	cmd.Env = append(os.Environ(), "AT_RECORDER_ROOT="+root)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("launcher: %v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(root, "healthy")); err != nil {
		t.Fatal("new process did not run")
	}
}

func TestLauncherDoesNotLoopWhenPreviousAgentAlsoFails(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string]string{
		"agent-launcher.sh": agentLauncher,
		"at-recorder":       "#!/bin/sh\nexit 12\n",
		".previous-agent":   "#!/bin/sh\necho attempt >> attempts\nexit 13\n",
		".update.json":      "{}",
	} {
		os.WriteFile(filepath.Join(root, name), []byte(body), 0755)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", filepath.Join(root, "agent-launcher.sh"))
	cmd.Env = append(os.Environ(), "AT_RECORDER_ROOT="+root)
	if err := cmd.Run(); err == nil || ctx.Err() != nil {
		t.Fatal("launcher should exit for service recovery instead of hot-looping")
	}
	attempts, _ := os.ReadFile(filepath.Join(root, "attempts"))
	if string(attempts) != "attempt\n" {
		t.Fatal("previous agent was repeatedly restored")
	}
}
