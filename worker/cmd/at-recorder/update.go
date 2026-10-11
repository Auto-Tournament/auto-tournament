package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type updateRequest struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Image        string `json:"image"`
	Busy         bool   `json:"busy"`
	AgentVersion string `json:"agentVersion"`
	AgentURL     string `json:"agentURL"`
	AgentSHA     string `json:"agentSHA"`
}
type updateJournal struct {
	Request       updateRequest
	PreviousImage string
	Compose       []byte
	Phase         string
	Error         string
	Deadline      int64
}

func (a *agent) journalPath() string { return filepath.Join(a.root, ".update.json") }
func (a *agent) saveUpdate(j *updateJournal) error {
	b, err := json.Marshal(j)
	if err != nil {
		return err
	}
	return atomicFile(a.journalPath(), b)
}
func (a *agent) acknowledge(ctx context.Context, j *updateJournal, status, image, revision string) error {
	body := map[string]string{"id": j.Request.ID, "status": status, "error": j.Error, "agentVersion": version}
	if image != "" {
		body["image"] = image
	}
	if revision != "" {
		body["revision"] = revision
	}
	return a.apiPath(ctx, "update", body, nil)
}

// A pinned image changes only Compose's image field; mounted Steam/game/config state is untouched.
func pinnedCompose(original []byte, image string) ([]byte, error) {
	if !imagePattern.MatchString(image) {
		return nil, errors.New("official pinned recorder image required")
	}
	re := regexp.MustCompile(`(?m)^([ \t]+image:[ \t]*)([^\r\n]+)$`)
	matches := re.FindAllSubmatchIndex(original, -1)
	if len(matches) != 1 {
		return nil, errors.New("expected exactly one Compose image field")
	}
	line := string(original[matches[0][4]:matches[0][5]])
	if !strings.HasPrefix(strings.Trim(line, `"' `), "sivertio/auto-tournament-recorder") {
		return nil, errors.New("Compose does not describe the official recorder")
	}
	m := matches[0]
	out := append([]byte{}, original[:m[4]]...)
	out = append(out, []byte(image)...)
	out = append(out, original[m[5]:]...)
	return out, nil
}
func (a *agent) writeCompose(b []byte) error {
	return writeConfig(filepath.Join(a.root, "compose.yml"), b)
}
func (a *agent) recreate(ctx context.Context) error {
	_, err := a.run(ctx, "compose", "up", "-d", "--force-recreate", "at-recorder")
	return err
}
func (a *agent) runtimeHealthy(ctx context.Context, image string) error {
	installed, _, err := a.installed(ctx)
	if err != nil {
		return err
	}
	if installed != image {
		return errors.New("installed recorder digest differs from requested image")
	}
	for _, args := range [][]string{
		{"exec", "at-recorder", "test", "-S", "/run/user/99/bus"},
		{"exec", "at-recorder", "nvidia-smi", "--query-gpu=name", "--format=csv,noheader"},
		{"exec", "at-recorder", "pgrep", "-x", "steam"},
		{"exec", "at-recorder", "test", "-S", "/run/user/99/pipewire-0"},
		{"exec", "at-recorder", "test", "-x", "/mnt/games/GameLibrary/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2"},
		{"exec", "-u", "99", "-e", "XDG_RUNTIME_DIR=/run/user/99", "at-recorder", "systemctl", "--user", "is-active", "at-recorder"},
	} {
		if _, err := a.run(ctx, args...); err != nil {
			return err
		}
	}
	return nil
}
func (a *agent) waitHealthy(ctx context.Context, j *updateJournal, image string) error {
	health, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	var last error
	for health.Err() == nil {
		if last = a.runtimeHealthy(health, image); last == nil {
			return nil
		}
		// Renew the update acknowledgement while the NVIDIA desktop starts.
		_ = a.acknowledge(health, j, "updating", "", "")
		if err := a.wait(health, 10*time.Second); err != nil {
			break
		}
	}
	return fmt.Errorf("recorder startup did not become healthy: %w", last)
}

// Recovery reuses the persisted request and original Compose. A lost final acknowledgement
// never reinstalls a healthy container; it retries only the acknowledgement.
func (a *agent) managedUpdate(ctx context.Context) error {
	var req updateRequest
	if err := a.apiPath(ctx, "update?protocol=1", nil, &req); err != nil {
		return err
	}
	var j updateJournal
	b, err := os.ReadFile(a.journalPath())
	if err == nil {
		if err = json.Unmarshal(b, &j); err != nil {
			return fmt.Errorf("invalid update journal: %w", err)
		}
		if j.Request.ID == "" || !imagePattern.MatchString(j.Request.Image) || !imagePattern.MatchString(j.PreviousImage) {
			return errors.New("invalid persisted update request; recovery needs repair")
		}
		switch j.Phase {
		case "draining", "applying", "complete", "rollback", "rollback-check", "failed":
		default:
			return errors.New("invalid persisted update phase; recovery needs repair")
		}
	} else if !os.IsNotExist(err) {
		return err
	} else {
		// Completion removes the journal first. A crash before removing its backups
		// must not make the next request look like a failed binary installation.
		for _, name := range []string{".agent-rollback", ".previous-agent", ".next-agent"} {
			if cleanupErr := os.Remove(filepath.Join(a.root, name)); cleanupErr != nil && !os.IsNotExist(cleanupErr) {
				return cleanupErr
			}
		}
	}
	if j.Request.ID == "" {
		if req.Status != "queued" && req.Status != "updating" {
			return nil
		}
		if req.ID == "" || len(req.ID) > 80 || !imagePattern.MatchString(req.Image) {
			return errors.New("invalid platform update request")
		}
		previous, _, err := a.installed(ctx)
		if err != nil {
			return err
		}
		compose, err := os.ReadFile(filepath.Join(a.root, "compose.yml"))
		if err != nil {
			return err
		}
		if _, err = pinnedCompose(compose, req.Image); err != nil {
			return err
		}
		j = updateJournal{Request: req, PreviousImage: previous, Compose: compose, Phase: "draining", Deadline: time.Now().Add(45 * time.Minute).Unix()}
		if err = a.saveUpdate(&j); err != nil {
			return err
		}
	}
	if _, markerErr := os.Stat(filepath.Join(a.root, ".agent-rollback")); markerErr == nil && j.Request.ID != "" && (j.Phase == "complete" || j.Phase == "applying") {
		j.Phase = "rollback"
		j.Error = "New host agent failed; restoring previous agent and recorder"
		if err = a.saveUpdate(&j); err != nil {
			return err
		}
	}
	if req.ID != j.Request.ID {
		if (j.Phase == "complete" && (j.Request.AgentVersion == "" || j.Request.AgentVersion == version)) || j.Phase == "failed" {
			image, _, inspectErr := a.installed(ctx)
			expected := j.Request.Image
			if j.Phase == "failed" {
				expected = j.PreviousImage
			}
			if inspectErr == nil && image == expected {
				// A new server request proves the previous completion was received, even
				// if its response was lost. Finish local cleanup and consume it next tick.
				return a.clearUpdate()
			}
		}
		return errors.New("platform update changed while local recovery is pending")
	}
	if j.Phase == "complete" && j.Request.AgentVersion != "" && j.Request.AgentVersion != version {
		return a.activateBinary(&j)
	}
	if j.Phase == "complete" || j.Phase == "failed" {
		image, revision, err := a.installed(ctx)
		if err != nil {
			return err
		}
		if j.Phase == "complete" {
			if err := a.runtimeHealthy(ctx, j.Request.Image); err != nil {
				j.Phase = "rollback"
				j.Error = "Replacement runtime became unhealthy before completion"
				if saveErr := a.saveUpdate(&j); saveErr != nil {
					return saveErr
				}
				if _, backupErr := os.Stat(filepath.Join(a.root, ".previous-agent")); backupErr == nil {
					if restoreErr := a.restoreBinary(); restoreErr != nil {
						return restoreErr
					}
					return errRestartAgent
				}
				return nil
			}
		}
		status := "current"
		if j.Phase == "failed" {
			status = "failed"
		}
		if err = a.acknowledge(ctx, &j, status, image, revision); err != nil {
			return err
		}
		return a.clearUpdate()
	}
	if req.Status != "queued" && req.Status != "updating" {
		if j.Phase == "draining" {
			j.Phase = "failed"
			j.Error = "Platform cancelled the request before installation; recorder preserved"
			return a.saveUpdate(&j)
		}
		return errors.New("platform no longer gates this recorder; refusing to recreate it")
	}
	if err = a.acknowledge(ctx, &j, "updating", "", ""); err != nil {
		return err
	}
	if j.Phase == "draining" {
		if time.Now().Unix() > j.Deadline {
			j.Phase = "failed"
			j.Error = "Drain deadline exceeded; running job was not interrupted"
			return a.saveUpdate(&j)
		}
		if req.Busy {
			return nil
		}
		// The worker writes this only after a successful no-work response and closing CS2.
		if _, err = a.run(ctx, "exec", "at-recorder", "test", "-f", "/mnt/clips/recorder-idle"); err != nil {
			return nil
		}
		if err = a.stageBinary(ctx, &j); err != nil {
			j.Phase = "failed"
			j.Error = "Host binary verification failed; recorder preserved"
			return a.saveUpdate(&j)
		}
		if j.Request.Image != j.PreviousImage {
			pull, cancel := context.WithTimeout(ctx, 10*time.Minute)
			_, err = a.run(pull, "pull", j.Request.Image)
			cancel()
			if err != nil {
				j.Phase = "failed"
				j.Error = "Image pull failed; running container preserved"
				return a.saveUpdate(&j)
			}
		}
		// Capture an immutable rollback image, even when the old Compose used :next.
		j.Compose, err = pinnedCompose(j.Compose, j.PreviousImage)
		if err != nil {
			return err
		}
		j.Phase = "applying"
		if err = a.saveUpdate(&j); err != nil {
			return err
		}
	}
	if j.Phase == "applying" {
		compose, err := pinnedCompose(j.Compose, j.Request.Image)
		if err != nil {
			return err
		}
		if err = a.writeCompose(compose); err != nil {
			return err
		}
		if j.Request.Image != j.PreviousImage {
			if err = a.recreate(ctx); err == nil {
				err = a.waitHealthy(ctx, &j, j.Request.Image)
			}
		} else {
			err = a.runtimeHealthy(ctx, j.Request.Image)
		}
		if err == nil {
			j.Phase = "complete"
			return a.saveUpdate(&j)
		}
		j.Error = "New recorder failed startup; restoring the previous pinned image"
		j.Phase = "rollback"
		if err = a.saveUpdate(&j); err != nil {
			return err
		}
	}
	if j.Phase == "rollback" {
		if err = a.writeCompose(j.Compose); err != nil {
			return err
		}
		installed, _, inspectErr := a.installed(ctx)
		if inspectErr != nil || installed != j.PreviousImage {
			if err = a.recreate(ctx); err != nil {
				return err
			}
		}
		j.Phase = "rollback-check"
		if err = a.saveUpdate(&j); err != nil {
			return err
		}
	}
	if j.Phase == "rollback-check" {
		if err = a.waitHealthy(ctx, &j, j.PreviousImage); err != nil {
			j.Error = "Rollback needs manual repair; recorder remains gated"
			if saveErr := a.saveUpdate(&j); saveErr != nil {
				return saveErr
			}
			_ = a.acknowledge(ctx, &j, "updating", "", "")
			return fmt.Errorf("rollback needs repair: %w", err)
		}
		j.Phase = "failed"
		return a.saveUpdate(&j)
	}
	return nil
}

func (a *agent) clearUpdate() error {
	if err := os.Remove(a.journalPath()); err != nil {
		return err
	}
	for _, name := range []string{".agent-rollback", ".previous-agent", ".next-agent"} {
		_ = os.Remove(filepath.Join(a.root, name))
	}
	return nil
}
