//go:build linux

package main

import (
	"errors"
	"os"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

func nativeDemoMap(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	p := dem.NewParser(f)
	defer p.Close()
	var mapName string
	p.RegisterNetMessageHandler(func(h *msg.CDemoFileHeader) { mapName = h.GetMapName() })
	for i := 0; i < 32; i++ {
		more, err := p.ParseNextFrame()
		if mapName != "" {
			return mapName, nil
		}
		if err != nil {
			return "", err
		}
		if !more {
			break
		}
	}
	return "", errors.New("the demo does not contain a map name")
}
