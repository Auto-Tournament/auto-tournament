package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// gpuName is the GPU the recorder runs on, for the platform's Recorders page.
func gpuName() string {
	if out, err := exec.Command("nvidia-smi", "--query-gpu=name", "--format=csv,noheader").Output(); err == nil {
		if s := strings.TrimSpace(strings.Split(string(out), "\n")[0]); s != "" {
			return s
		}
	}
	if out, err := exec.Command("glxinfo", "-B").Output(); err == nil {
		for _, l := range strings.Split(string(out), "\n") {
			if strings.Contains(l, "OpenGL renderer string:") {
				return strings.TrimSpace(strings.SplitN(l, ":", 2)[1])
			}
		}
	}
	if out, err := exec.Command("lspci", "-mm").Output(); err == nil {
		for _, l := range strings.Split(string(out), "\n") {
			if strings.Contains(l, "VGA") || strings.Contains(l, "3D controller") {
				f := strings.Split(l, `"`)
				if len(f) >= 6 {
					return f[3] + " " + f[5]
				}
			}
		}
	}
	return ""
}

// platformName is where the recorder runs: "linux/amd64", plus "docker" in a container.
func platformName() string {
	p := runtime.GOOS + "/" + runtime.GOARCH
	if _, err := os.Stat("/.dockerenv"); err == nil {
		p += " · docker"
	}
	return p
}
