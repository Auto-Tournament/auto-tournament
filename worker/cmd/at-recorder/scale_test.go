package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const scaleBaseCompose = `services:
  at-recorder:
    image: sivertio/auto-tournament-recorder:next
    container_name: at-recorder
    hostname: at-recorder
    environment:
      - NVIDIA_VISIBLE_DEVICES=GPU-old
      - COMPOSITOR_RENDER_DEVICE=/dev/dri/renderD128
      - ENCODER_RENDER_DEVICE=/dev/dri/renderD128
    ports:
      - "8483:8483"
      - "8483:8483/udp"
    volumes:
      - ./home/:/home/steamheadless/:rw
`

func scaleInst() scaleInstance {
	return scaleInstance{Number: 2, Name: "box-2", CardUUID: "GPU-b", Bus: "0000:82:00.0", RenderNode: "/dev/dri/renderD129", Port: 8484, OnCard: 2}
}

func TestInstanceComposePinsTheCard(t *testing.T) {
	b, err := instanceCompose([]byte(scaleBaseCompose), scaleInst())
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for _, want := range []string{
		"container_name: box-2\n",
		"at.recorder.scaled-gpu: GPU-b\n",
		"hostname: box-2\n",
		"- NVIDIA_VISIBLE_DEVICES=all\n",
		"- DRI_PRIME=pci-0000_82_00_0\n",
		"- CUDA_VISIBLE_DEVICES=GPU-b\n",
		"- COMPOSITOR_RENDER_DEVICE=/dev/dri/renderD129\n",
		"- ENCODER_RENDER_DEVICE=/dev/dri/renderD129\n",
		`- "8484:8483"`,
		`- "8484:8483/udp"`,
		"./home/:/home/steamheadless/:rw",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "GPU-old") || strings.Contains(got, "renderD128") {
		t.Fatalf("old card left:\n%s", got)
	}
}

func TestInstanceComposeFromAnAlreadyPinnedBase(t *testing.T) {
	base := strings.Replace(scaleBaseCompose, "      - COMPOSITOR", "      - DRI_PRIME=pci-0000_81_00_0\n      - CUDA_VISIBLE_DEVICES=GPU-a\n      - COMPOSITOR", 1)
	b, err := instanceCompose([]byte(base), scaleInst())
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	if strings.Count(got, "DRI_PRIME=") != 1 || strings.Count(got, "CUDA_VISIBLE_DEVICES=") != 1 || strings.Contains(got, "GPU-a") {
		t.Fatalf("old card left:\n%s", got)
	}
}

func TestInstanceComposeKeepsAnEncoderCudaIndex(t *testing.T) {
	base := strings.Replace(scaleBaseCompose, "ENCODER_RENDER_DEVICE=/dev/dri/renderD128", "ENCODER_RENDER_DEVICE=cuda:0", 1)
	b, err := instanceCompose([]byte(base), scaleInst())
	if err != nil || !strings.Contains(string(b), "ENCODER_RENDER_DEVICE=cuda:0") {
		t.Fatalf("%v\n%s", err, b)
	}
}

func TestInstanceComposeRefusesWhatItCannotPin(t *testing.T) {
	for _, line := range []string{"      - NVIDIA_VISIBLE_DEVICES=GPU-old\n", "    container_name: at-recorder\n", "      - COMPOSITOR_RENDER_DEVICE=/dev/dri/renderD128\n", "    hostname: at-recorder\n"} {
		if _, err := instanceCompose([]byte(strings.Replace(scaleBaseCompose, line, "", 1)), scaleInst()); err == nil {
			t.Errorf("without %q it should refuse", line)
		}
	}
}

func TestParseScaleCards(t *testing.T) {
	c := parseScaleCards("GPU-a, 00000000:81:00.0, 12288, 1428\nGPU-b, 00000000:82:00.0, 12288, 1\nnonsense\n")
	if len(c) != 2 || c[1] != (scaleCard{UUID: "GPU-b", Bus: "0000:82:00.0", TotalMB: 12288, UsedMB: 1}) {
		t.Fatalf("%+v", c)
	}
}

func TestRenderNodeOf(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "0000:82:00.0/drm/renderD129"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, err := renderNodeOf(dir, "0000:82:00.0"); err != nil || got != "/dev/dri/renderD129" {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := renderNodeOf(dir, "0000:81:00.0"); err == nil {
		t.Fatal("no node should fail")
	}
}

func TestFinishInstanceSettings(t *testing.T) {
	root, dir := t.TempDir(), t.TempDir()
	for _, p := range []string{filepath.Join(root, "clips"), filepath.Join(dir, "config"), filepath.Join(dir, "home2/.local/share/Steam/config")} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	users := filepath.Join(dir, "home2/.local/share/Steam/config/loginusers.vdf")
	if err := os.WriteFile(users, []byte("\"WantsOfflineMode\"\t\t\"0\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config/at-recorder.env"), []byte("AT_URL=https://at.example.com\nAT_WORKER_NAME=box\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := finishInstance(root, dir, []byte("x"), scaleInst()); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(users); !strings.Contains(string(b), `"1"`) {
		t.Fatalf("Steam not offline: %s", b)
	}
	env, _ := os.ReadFile(filepath.Join(dir, "config/at-recorder.env"))
	for _, want := range []string{"AT_URL=https://at.example.com", "AT_WORKER_NAME=box-2", "DRI_PRIME=pci-0000_82_00_0", "CUDA_VISIBLE_DEVICES=GPU-b", "AT_RECORDERS_PER_GPU=2", "AT_CS2_UPDATE=0"} {
		if !strings.Contains(string(env), want) {
			t.Errorf("missing %q in:\n%s", want, env)
		}
	}
	if !exists(filepath.Join(dir, "clips")) {
		t.Fatal("no clips folder")
	}
}
