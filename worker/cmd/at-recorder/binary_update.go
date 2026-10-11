package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var errRestartAgent = errors.New("restart host agent to apply the verified binary")
var binaryVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?$`)

func validBinaryTarget(req updateRequest) bool {
	return binaryVersion.MatchString(req.AgentVersion) && regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(req.AgentSHA) && req.AgentURL == "https://github.com/Auto-Tournament/auto-tournament/releases/download/at-recorder-v"+req.AgentVersion+"/at-recorder-linux-amd64.tar.gz"
}
func unpackBinary(archive []byte, checksum string) ([]byte, error) {
	digest := sha256.Sum256(archive)
	if hex.EncodeToString(digest[:]) != checksum {
		return nil, errors.New("host binary archive checksum mismatch")
	}
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	tr := tar.NewReader(io.LimitReader(gz, 64<<20))
	var binary []byte
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if h.Name != "at-recorder" {
			continue
		}
		if binary != nil || h.Typeflag != tar.TypeReg || h.Size < 1 || h.Size > 20<<20 {
			return nil, errors.New("invalid host binary archive member")
		}
		binary, err = io.ReadAll(io.LimitReader(tr, (20<<20)+1))
		if err != nil {
			return nil, err
		}
	}
	if len(binary) < 4 || !bytes.Equal(binary[:4], []byte{0x7f, 'E', 'L', 'F'}) {
		return nil, errors.New("archive contains no Linux host binary")
	}
	return binary, nil
}
func (a *agent) downloadBinary(ctx context.Context, req updateRequest) ([]byte, error) {
	if !validBinaryTarget(req) {
		return nil, errors.New("invalid official host binary release")
	}
	client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || req.URL.Scheme != "https" || req.URL.Hostname() != "release-assets.githubusercontent.com" {
			return errors.New("unexpected binary download redirect")
		}
		return nil
	}}
	request, err := http.NewRequestWithContext(ctx, "GET", req.AgentURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("binary download HTTP %d", res.StatusCode)
	}
	archive, err := io.ReadAll(io.LimitReader(res.Body, (30<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(archive) > 30<<20 {
		return nil, errors.New("binary archive too large")
	}
	return unpackBinary(archive, req.AgentSHA)
}
func (a *agent) stageBinary(ctx context.Context, j *updateJournal) error {
	if j.Request.AgentVersion == "" || j.Request.AgentVersion == version {
		return nil
	}
	path := filepath.Join(a.root, ".next-agent")
	b, err := a.downloadBinary(ctx, j.Request)
	if err != nil {
		return err
	}
	if err = atomicFile(path, b); err != nil {
		return err
	}
	if err = os.Chmod(path, 0755); err != nil {
		return err
	}
	check, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	got, err := exec.CommandContext(check, path, "version").Output()
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(got)) != j.Request.AgentVersion {
		return errors.New("downloaded agent version differs from the pinned release")
	}
	// Keep a durable previous binary until the new process has acknowledged success.
	current, err := os.ReadFile(filepath.Join(a.root, "at-recorder"))
	if err != nil {
		return err
	}
	return atomicFile(filepath.Join(a.root, ".previous-agent"), current)
}
func (a *agent) activateBinary(j *updateJournal) error {
	if j.Request.AgentVersion == "" || j.Request.AgentVersion == version {
		return nil
	}
	if err := os.Rename(filepath.Join(a.root, ".next-agent"), filepath.Join(a.root, "at-recorder")); err != nil {
		return err
	}
	return errRestartAgent
}

func (a *agent) restoreBinary() error {
	b, err := os.ReadFile(filepath.Join(a.root, ".previous-agent"))
	if err != nil {
		return err
	}
	if err = atomicFile(filepath.Join(a.root, "at-recorder"), b); err != nil {
		return err
	}
	return os.Chmod(filepath.Join(a.root, "at-recorder"), 0755)
}
