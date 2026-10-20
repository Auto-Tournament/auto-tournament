//go:build linux

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Dedicated Selkies desktops can use fractional scaling, making a physical
// 1080p output expose only a 720p XWayland desktop. Opt in only on dedicated
// recorders; ordinary desktop users keep their display configuration.
func prepareNativeDisplay(ctx context.Context, width, height int) error {
	if env("AT_NATIVE_DISPLAY_SETUP", "") != "1" {
		return nil
	}
	data, err := exec.CommandContext(ctx, "wlr-randr", "--json").Output()
	if err != nil {
		return fmt.Errorf("native display discovery: %w", err)
	}
	var outputs []struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
		Modes   []struct {
			Width   int  `json:"width"`
			Height  int  `json:"height"`
			Current bool `json:"current"`
		} `json:"modes"`
	}
	if err := json.Unmarshal(data, &outputs); err != nil {
		return err
	}
	for _, output := range outputs {
		if !output.Enabled {
			continue
		}
		args := []string{"--output", output.Name, "--scale", "1"}
		fits, exact := false, false
		for _, mode := range output.Modes {
			if mode.Current && mode.Width >= width && mode.Height >= height {
				fits = true
			}
			if mode.Width == width && mode.Height == height {
				exact = true
			}
		}
		if exact {
			args = append(args, "--mode", fmt.Sprintf("%dx%d", width, height))
		} else if !fits {
			return fmt.Errorf("native desktop is smaller than %dx%d; set the Steam desktop's manual resolution before recording", width, height)
		}
		// A browser-sized Wayland output often has only one advertised mode.
		// A larger output can host the requested CS2 window without switching.
		if b, err := exec.CommandContext(ctx, "wlr-randr", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("native display mode: %w: %s", err, b)
		}
		home, _ := os.UserHomeDir()
		return prepareNativeWindowRules(ctx, filepath.Join(home, ".config", "labwc", "rc.xml"))
	}
	return errors.New("native display setup found no enabled Wayland output")
}

// LinuxServer's Steam desktop maximizes all windows by default. On a
// dedicated recorder that changes CS2's movie size to the browser's size.
func prepareNativeWindowRules(ctx context.Context, path string) (err error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	rule := regexp.MustCompile(`<windowRule\s+identifier="\*"\s*>\s*<action\s+name="Maximize"\s*/>\s*</windowRule>`)
	updated := rule.ReplaceAll(data, nil)
	if bytes.Equal(data, updated) {
		return nil
	}
	backup, err := os.OpenFile(path+".at-native-original", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		_, err = backup.Write(data)
		closeErr := backup.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	} else if !os.IsExist(err) {
		return err
	}
	if err := writeNativeFile(path, updated, 0644); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, writeNativeFile(path, data, 0644))
		}
	}()
	command := exec.CommandContext(ctx, "labwc", "--reconfigure")
	pid := os.Getenv("LABWC_PID")
	if pid == "" {
		data, err := exec.CommandContext(ctx, "pgrep", "-u", strconv.Itoa(os.Getuid()), "-x", "labwc").Output()
		if err != nil || len(strings.Fields(string(data))) != 1 {
			return errors.New("native window rules: could not identify the desktop's labwc process")
		}
		pid = strings.TrimSpace(string(data))
	}
	command.Env = append(os.Environ(), "LABWC_PID="+pid)
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("native window rules: %w: %s", err, output)
	}
	return nil
}

func nativeOOMKills() uint64 {
	data, _ := os.ReadFile("/sys/fs/cgroup/memory.events")
	fields := strings.Fields(string(data))
	for i := 0; i+1 < len(fields); i += 2 {
		if fields[i] == "oom_kill" {
			n, _ := strconv.ParseUint(fields[i+1], 10, 64)
			return n
		}
	}
	return 0
}
