//go:build linux

package main

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"syscall"
)

// Patch only the search path, keeping a backup for cleanup or crash recovery.
var nativeSearchPath = regexp.MustCompile(`(?m)^([\t ]*Game[\t ]+)csgo[\t ]*\r?$`)

func writeNativeFile(path string, data []byte, mode fs.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".at-native-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err := f.Chmod(mode); err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func installNativePlugin(gameDir string) (func(), error) {
	info := filepath.Join(gameDir, "csgo", "gameinfo.gi")
	backup := info + ".backup"
	lock, err := os.OpenFile(info+".at-native.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	installed := false
	defer func() {
		if !installed {
			lock.Close()
		}
	}()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil, fmt.Errorf("native plugin installation is in use: %w", err)
	}
	if err := recoverNativeGameinfo(info, backup); err != nil {
		return nil, err
	}
	original, err := os.ReadFile(info)
	if err != nil {
		return nil, err
	}
	infoStat, err := os.Stat(info)
	if err != nil {
		return nil, err
	}
	if !nativeSearchPath.Match(original) || bytes.Contains(original, []byte("csgo/at-native")) {
		return nil, errors.New("cannot install native plugin: unrecognized or already modified gameinfo.gi search paths")
	}
	pluginPath := os.Getenv("AT_NATIVE_PLUGIN")
	if pluginPath == "" {
		return nil, errors.New("set AT_NATIVE_PLUGIN to Auto Tournament's native recorder libserver.so; no plugin is bundled")
	}
	plugin, err := os.ReadFile(pluginPath)
	if err != nil {
		return nil, fmt.Errorf("read AT_NATIVE_PLUGIN: %w", err)
	}
	if len(plugin) == 0 {
		return nil, errors.New("AT_NATIVE_PLUGIN is empty")
	}
	bin := filepath.Join(gameDir, "csgo", "at-native", "bin", "linuxsteamrt64")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		return nil, err
	}
	if err := writeNativeFile(filepath.Join(bin, "libserver.so"), plugin, 0o755); err != nil {
		return nil, err
	}
	modified := nativeSearchPath.ReplaceAll(original, []byte("${1}csgo/at-native\n${1}csgo"))
	f, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_WRONLY, infoStat.Mode().Perm())
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(original)
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		_ = os.Remove(backup)
		return nil, err
	}
	var restored sync.Once
	restore := func() {
		restored.Do(func() {
			defer lock.Close()
			current, err := os.ReadFile(info)
			if err == nil && bytes.Equal(current, modified) {
				if err := writeNativeFile(info, original, infoStat.Mode().Perm()); err != nil {
					log.Printf("restore native gameinfo: %v", err)
					return
				}
			} else if err != nil || !bytes.Equal(current, original) {
				log.Printf("native gameinfo changed during recording; retaining backup at %s", backup)
				return
			}
			if saved, err := os.ReadFile(backup); err == nil && bytes.Equal(saved, original) {
				if err := os.Remove(backup); err != nil {
					log.Printf("remove native gameinfo backup: %v", err)
				}
			}
		})
	}
	if err := writeNativeFile(info, modified, infoStat.Mode().Perm()); err != nil {
		_ = os.Remove(backup)
		return nil, err
	}
	installed = true
	return restore, nil
}

// Only recover an exact patch of a valid original; never overwrite other edits.
func recoverNativeGameinfo(info, backup string) error {
	saved, err := os.ReadFile(backup)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	current, err := os.ReadFile(info)
	if err != nil {
		return err
	}
	patched := nativeSearchPath.ReplaceAll(saved, []byte("${1}csgo/at-native\n${1}csgo"))
	if !nativeSearchPath.Match(saved) || bytes.Contains(saved, []byte("csgo/at-native")) ||
		(!bytes.Equal(current, patched) && !bytes.Equal(current, saved)) {
		return fmt.Errorf("cannot recover %s: it does not match our native search-path patch; inspect the backup manually", backup)
	}
	return os.Rename(backup, info)
}
