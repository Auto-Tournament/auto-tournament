package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed assets/*.sh
var installers embed.FS

// Injectable process boundary: provisioning tests must not modify the test host.
type setupRuntime struct {
	root, units, binary, owner string
	uid, gid                   int
	run                        func(context.Context, string, []string, []string, []byte) error
	agent                      func(string) (*agent, error)
}

func setup(root string, args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	adopt := fs.Bool("adopt", false, "adopt without changing the existing container")
	owner := fs.String("user", os.Getenv("SUDO_USER"), "non-root recorder owner")
	skip := fs.Bool("skip-deps", false, "dependencies are already installed")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected setup arguments")
	}
	if runtime.GOOS != "linux" {
		return fmt.Errorf("host installation requires Linux; fresh provisioning supports Ubuntu 24.04")
	}
	if os.Geteuid() != 0 {
		return fmt.Errorf("run sudo at-recorder setup --user USER")
	}
	if *owner == "" || *owner == "root" || strings.ContainsAny(*owner, "\n\r /\t%") {
		return fmt.Errorf("choose a non-root owner with --user")
	}
	if !filepath.IsAbs(root) || strings.ContainsAny(root, "\n\r %\t:\\\"") {
		return fmt.Errorf("root must be an absolute path without whitespace or systemd specifiers")
	}
	u, err := user.Lookup(*owner)
	if err != nil {
		return err
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return err
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	r := setupRuntime{root: root, units: "/etc/systemd/system", binary: exe, uid: uid, gid: gid, owner: *owner, agent: newAgent}
	r.run = func(ctx context.Context, name string, args, env []string, input []byte) error {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = append(os.Environ(), env...)
		cmd.Stdin = strings.NewReader(string(input))
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("%s failed: %w", name, err)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	return r.install(ctx, *adopt, *skip)
}
func (r setupRuntime) install(ctx context.Context, adopt, skipDeps bool) error {
	a, err := r.agent(r.root)
	if err != nil {
		return fmt.Errorf("connect first: %w", err)
	}
	compose := filepath.Join(r.root, "compose.yml")
	if adopt {
		if _, err = os.Stat(compose); err != nil {
			return fmt.Errorf("cannot adopt: %w", err)
		}
	} else {
		if _, err = os.Stat(compose); err == nil {
			return fmt.Errorf("existing installation found; use setup --adopt")
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if err = os.MkdirAll(r.units, 0755); err != nil {
		return err
	}
	data, err := os.ReadFile(r.binary)
	if err != nil {
		return err
	}
	dest := filepath.Join(r.root, "at-recorder")
	if err = atomicFile(dest, data); err != nil {
		return err
	}
	if err = os.Chmod(dest, 0755); err != nil {
		return err
	}
	for _, path := range []string{r.root, filepath.Join(r.root, ".host-id")} {
		if err = os.Chown(path, r.uid, r.gid); err != nil {
			return err
		}
	}
	if !adopt {
		if !skipDeps {
			script, err := installers.ReadFile("assets/setup-host.sh")
			if err != nil {
				return err
			}
			fmt.Println("Preparing NVIDIA, Docker and host runtime...")
			if err = r.run(ctx, "bash", []string{"-s", "--", r.owner}, []string{"AT_RECORDER_DIR=" + r.root}, script); err != nil {
				return err
			}
		}
		if err = r.run(ctx, "nvidia-smi", []string{"--query-gpu=name,driver_version", "--format=csv,noheader"}, nil, nil); err != nil {
			return fmt.Errorf("NVIDIA is not ready; reboot after driver installation and rerun setup: %w", err)
		}
		if err = r.run(ctx, "usermod", []string{"-aG", "docker", r.owner}, nil, nil); err != nil {
			return err
		}
		// Register before the in-container worker starts. New platform rows are disabled.
		var hello struct {
			Name string `json:"name"`
		}
		if err = a.apiPath(ctx, "hello", map[string]string{"name": a.name, "hostname": a.hostname, "hostId": a.hostID, "agentVersion": version}, &hello); err != nil {
			return fmt.Errorf("registration failed; container not started: %w", err)
		}
		if hello.Name != a.name {
			return fmt.Errorf("platform returned a different identity")
		}
		script, err := installers.ReadFile("assets/start-recorder.sh")
		if err != nil {
			return err
		}
		fmt.Println("Starting Steam desktop; sign in and install CS2 in its web UI...")
		if err = r.run(ctx, "bash", []string{"-s"}, []string{"AT_RECORDER_DIR=" + r.root, "AT_URL=" + a.base, "AT_WORKER_TOKEN=" + a.token, "AT_WORKER_NAME=" + a.name}, script); err != nil {
			return err
		}
		for _, file := range []string{".env", "compose.yml", "config/at-recorder.service"} {
			if err = os.Chown(filepath.Join(r.root, file), r.uid, r.gid); err != nil {
				return err
			}
		}
		if err = os.Chown(filepath.Join(r.root, "config"), r.uid, 100); err != nil {
			return err
		}
		if err = os.Chown(filepath.Join(r.root, "config/at-recorder.env"), r.uid, 100); err != nil {
			return err
		}
	}
	// Adoption inspects and registers without restarting the recorder container.
	if err = a.tick(ctx); err != nil {
		return fmt.Errorf("host registration failed: %w", err)
	}
	if err = atomicFile(filepath.Join(r.units, "at-recorder-agent.service"), []byte(serviceUnit(r.owner, r.root, dest))); err != nil {
		return err
	}
	if err = os.Chmod(filepath.Join(r.units, "at-recorder-agent.service"), 0644); err != nil {
		return err
	}
	for _, args := range [][]string{{"daemon-reload"}, {"enable", "at-recorder-agent.service"}, {"restart", "at-recorder-agent.service"}} {
		if err = r.run(ctx, "systemctl", args, nil, nil); err != nil {
			return err
		}
	}
	fmt.Println("Host service installed. Run at-recorder doctor. Existing Steam, CS2, worker identity and enabled settings are preserved. New hosts stay disabled in AT.")
	return nil
}
func serviceUnit(owner, root, binary string) string {
	return fmt.Sprintf("[Unit]\nDescription=Auto Tournament recorder host agent\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nUser=%s\nSupplementaryGroups=docker\nWorkingDirectory=%s\nEnvironment=AT_RECORDER_ROOT=%s\nExecStart=%s agent\nRestart=on-failure\nRestartSec=15\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target\n", owner, root, root, binary)
}
func fileOwner(path string) (int, int, error) {
	s, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	v := s.Sys().(*syscall.Stat_t)
	return int(v.Uid), int(v.Gid), nil
}
