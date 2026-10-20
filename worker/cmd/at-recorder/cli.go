package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func cli(root string, args []string) (bool, error) {
	if len(args) == 0 || (len(args) == 1 && args[0] == "agent") {
		return false, nil
	}
	switch args[0] {
	case "help", "--help", "-h":
		fmt.Println("at-recorder: manage a Linux highlight recorder host\n\n  connect URL [KEY]          connect to AT (KEY may be read from stdin)\n  link URL KEY              also record for another AT platform (in turn)\n  unlink URL                stop recording for that platform\n  setup --user USER         provision a fresh Ubuntu NVIDIA host\n  setup --adopt --user USER  adopt an existing recorder without restarting it\n  doctor                    check Docker, NVIDIA, Steam, CS2 and platform access\n  status                    show host identity and installed runtime\n  update [--check]          update the recorder and host agent (as the platform's Update button)\n  logs [-f] [-n LINES]      the host agent's and the worker's logs, secrets hidden\n  restart [--force]         restart the worker when idle (--force: mid-job, after a yes)\n  agent                     report identity and software versions to AT\n  version                   print the host binary version\n\nAT_RECORDER_ROOT defaults to /srv/at-recorder. New hosts register disabled.\nSteam sign-in and installing CS2 require the Steam web desktop after fresh setup.")
		return true, nil
	case "version":
		if len(args) != 1 {
			return true, fmt.Errorf("usage: at-recorder version")
		}
		fmt.Println(version)
		return true, nil
	case "connect":
		return true, connect(root, args[1:])
	case "link", "unlink":
		a, err := newAgent(root)
		if err != nil {
			return true, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if args[0] == "link" {
			if len(args) != 3 {
				return true, fmt.Errorf("usage: at-recorder link URL KEY")
			}
			err = a.link(ctx, args[1], args[2])
		} else {
			if len(args) != 2 {
				return true, fmt.Errorf("usage: at-recorder unlink URL")
			}
			err = a.dropOther(strings.TrimRight(args[1], "/"))
		}
		if err == nil {
			fmt.Println("Saved. It takes effect when the recorder restarts: at-recorder restart")
		}
		return true, err
	case "setup":
		return true, setup(root, args[1:])
	case "doctor", "status":
		if len(args) != 1 {
			return true, fmt.Errorf("usage: at-recorder %s", args[0])
		}
		a, err := newAgent(root)
		if err != nil {
			return true, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if args[0] == "doctor" {
			return true, a.doctor(ctx)
		}
		image, revision, err := a.installed(ctx)
		if err != nil {
			return true, err
		}
		fmt.Printf("Recorder: %s\nHostname: %s\nInstallation: %s\nPlatform: %s\nHost agent: %s\nRecorder image: %s\nRecorder build: %s\n", a.name, a.hostname, a.hostID, a.base, version, image, revision)
		out, err := a.run(ctx, "inspect", "at-recorder", "--format", "{{.State.Status}} / {{if .State.Health}}{{.State.Health.Status}}{{else}}no health check{{end}}")
		if err != nil {
			return true, err
		}
		fmt.Printf("Container: %s\n", strings.TrimSpace(string(out)))
		return true, nil
	case "update":
		a, err := newAgent(root)
		if err != nil {
			return true, err
		}
		return true, a.updateCommand(context.Background(), args[1:], os.Stdout, 10*time.Second, 50*time.Minute)
	case "logs":
		return true, logsCommand(context.Background(), args[1:], os.Stdout)
	case "restart":
		a, err := newAgent(root)
		if err != nil {
			return true, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		return true, a.restartCommand(ctx, args[1:], stdinOrTTY(), os.Stdout)
	default:
		return true, fmt.Errorf("unknown command %q; use at-recorder help", args[0])
	}
}

// Keep unrelated settings and the established worker name when reconnecting.
func connectionConfig(old []byte, platform, key, hostname string) []byte {
	lines := []string{}
	hasName := false
	for _, line := range strings.Split(string(old), "\n") {
		k, _, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && (k == "AT_URL" || k == "AT_WORKER_TOKEN") {
			continue
		}
		if ok && k == "AT_WORKER_NAME" {
			hasName = true
		}
		if line != "" {
			lines = append(lines, line)
		}
	}
	lines = append(lines, "AT_URL="+strings.TrimRight(platform, "/"), "AT_WORKER_TOKEN="+key)
	if !hasName {
		lines = append(lines, "AT_WORKER_NAME="+hostname)
	}
	return []byte(strings.Join(lines, "\n") + "\n")
}
func connect(root string, args []string) error {
	if len(args) < 1 || len(args) > 2 {
		return fmt.Errorf("usage: at-recorder connect URL [KEY]")
	}
	u, err := platformURL(args[0])
	if err != nil {
		return err
	}
	key := ""
	if len(args) == 2 {
		key = args[1]
	} else {
		b, err := io.ReadAll(io.LimitReader(os.Stdin, 4097))
		if err != nil {
			return err
		}
		key = strings.TrimSpace(string(b))
	}
	if !validKey(key) {
		return fmt.Errorf("supply one recorder key (letters, numbers, dot, underscore or hyphen)")
	}
	hostname, err := os.Hostname()
	if err != nil {
		return err
	}
	conf := filepath.Join(root, "config")
	if err = os.MkdirAll(conf, 0700); err != nil {
		return err
	}
	path := filepath.Join(conf, "at-recorder.env")
	old, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	// Do not silently point an existing container at one platform while its agent
	// points at another. Reconnection of installed hosts needs a deliberate stop.
	if _, e := os.Stat(filepath.Join(root, "compose.yml")); e == nil {
		a, e := newAgent(root)
		if e != nil {
			return fmt.Errorf("existing installation needs repair: %w", e)
		}
		if a.base == strings.TrimRight(u.String(), "/") && a.token == key {
			fmt.Println("Existing connection, credentials and installation ID preserved.")
			return nil
		}
		if os.Geteuid() != 0 {
			return fmt.Errorf("reconnecting an installed host needs sudo; disable it in AT, wait for its current job, then stop its container first")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		next := connectionConfig(old, u.String(), key, hostname)
		return a.reconnect(ctx, next, old)
	}

	if err = writeConfig(path, connectionConfig(old, u.String(), key, hostname)); err != nil {
		return err
	}
	if _, err = machineID(root); err != nil {
		return err
	}
	fmt.Println("Connection saved. Run sudo at-recorder setup --user USER (or --adopt for an existing host). New recorders remain disabled until enabled in AT.")
	return nil
}

// Preserve owner and mode of mounted settings when replacing them atomically.
func writeConfig(path string, b []byte) error {
	uid, gid, ownerErr := fileOwner(path)
	stat, err := os.Stat(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	mode := os.FileMode(0600)
	if err == nil {
		mode = stat.Mode().Perm()
	}
	if err = atomicFile(path, b); err != nil {
		return err
	}
	if ownerErr == nil && os.Geteuid() == 0 {
		if err = os.Chown(path, uid, gid); err != nil {
			return err
		}
	}
	return os.Chmod(path, mode)
}
func (a *agent) doctor(ctx context.Context) error {
	checks := []struct {
		name string
		args []string
	}{
		{"Docker", []string{"info", "--format", "{{.ServerVersion}}"}},
		{"Container health", []string{"exec", "at-recorder", "test", "-S", "/run/user/99/bus"}},
		{"NVIDIA container access", []string{"exec", "at-recorder", "nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"}},
		{"Steam", []string{"exec", "at-recorder", "pgrep", "-x", "steam"}},
		{"Audio", []string{"exec", "at-recorder", "test", "-S", "/run/user/99/pipewire-0"}},
		{"CS2 installed", []string{"exec", "at-recorder", "test", "-x", "/mnt/games/GameLibrary/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2"}},
		{"Recorder service", []string{"exec", "-u", "99", "-e", "XDG_RUNTIME_DIR=/run/user/99", "at-recorder", "systemctl", "--user", "is-active", "at-recorder"}},
	}
	failed := false
	for _, check := range checks {
		if _, err := a.run(ctx, check.args...); err != nil {
			fmt.Printf("FAIL %s: %v\n", check.name, err)
			failed = true
		} else {
			fmt.Printf("OK   %s\n", check.name)
		}
	}
	if err := a.tick(ctx); err != nil {
		fmt.Printf("FAIL Platform: %v\n", err)
		failed = true
	} else {
		fmt.Println("OK   Platform identity and version report")
	}
	if failed {
		return fmt.Errorf("doctor failed; complete Steam sign-in, CS2 installation or the reported repair before enabling recording")
	}
	return nil
}

// Reconnection is explicit and only allowed with a stopped container. It never
// interrupts an active job and keeps the installation UUID and worker name.
func (a *agent) reconnect(ctx context.Context, next, previous []byte) error {
	state, err := a.run(ctx, "inspect", "at-recorder", "--format", "{{.State.Status}}")
	if err != nil {
		return err
	}
	if status := strings.TrimSpace(string(state)); status != "exited" && status != "created" {
		return fmt.Errorf("disable this recorder in AT, wait for its current job, then stop its container before reconnecting")
	}
	path := filepath.Join(a.root, "config/at-recorder.env")
	if err := writeConfig(path, next); err != nil {
		return err
	}
	replacement, err := newAgent(a.root)
	if err == nil {
		replacement.run = a.run
		replacement.http = a.http
		err = replacement.tick(ctx)
	}
	if err != nil {
		if restore := writeConfig(path, previous); restore != nil {
			return fmt.Errorf("connection rejected (%v); configuration restore failed: %w", err, restore)
		}
		return fmt.Errorf("connection rejected; original credentials and UUID preserved: %w", err)
	}
	if _, err = a.run(ctx, "compose", "up", "-d", "--force-recreate", "at-recorder"); err != nil {
		if restore := writeConfig(path, previous); restore != nil {
			return fmt.Errorf("container start failed (%v); configuration restore failed: %w", err, restore)
		}
		return fmt.Errorf("container start failed; original credentials restored, inspect container before retrying: %w", err)
	}
	if err := a.restart(ctx); err != nil {
		return fmt.Errorf("connection saved; restart at-recorder-agent.service to apply the new credentials: %w", err)
	}
	fmt.Println("Reconnected using the same installation ID. The new platform retains its existing enabled setting or registers this host disabled.")
	return nil
}
