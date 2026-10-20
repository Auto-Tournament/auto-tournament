//go:build linux

package main

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
)

//go:embed assets/native/libserver.so
var nativePlugin []byte

// Patch only the search path, using a private plugin directory. The plugin
// restores gameinfo.gi.backup as soon as it loads. The launcher also restores
// it on failure, so a failed launch does not leave CS2 modified.
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
	if runtime.GOARCH != "amd64" && os.Getenv("AT_CSDM_PLUGIN") == "" {
		return nil, errors.New("the bundled native plugin requires Linux amd64; AT_CSDM_PLUGIN must point to a plugin built for this architecture")
	}
	info := filepath.Join(gameDir, "csgo", "gameinfo.gi")
	backup := info + ".backup"
	if _, err := os.Stat(backup); err == nil {
		return nil, fmt.Errorf("%s already exists; restore the previous CS:DM gameinfo backup before recording", backup)
	} else if !os.IsNotExist(err) {
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
	plugin := nativePlugin
	if custom := os.Getenv("AT_CSDM_PLUGIN"); custom != "" {
		plugin, err = os.ReadFile(custom)
		if err != nil {
			return nil, err
		}
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
	restore := func() {
		// If the plugin restored it itself, our backup no longer exists.
		current, err := os.ReadFile(info)
		if err == nil && bytes.Equal(current, modified) {
			if writeNativeFile(info, original, infoStat.Mode().Perm()) != nil {
				return
			}
			_ = os.Remove(backup)
		}
	}
	if err := writeNativeFile(info, modified, infoStat.Mode().Perm()); err != nil {
		_ = os.Remove(backup)
		return nil, err
	}
	return restore, nil
}
