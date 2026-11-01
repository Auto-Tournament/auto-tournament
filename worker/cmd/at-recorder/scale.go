package main

// `at-recorder scale`: more recorders on a GPU, by hand. Each is a copy of this
// one (its own Steam home and CS2, a reflink where the disk can) pinned to the
// card. A card's video only works in a container that sees every GPU (NVENC and
// NVDEC refuse a second card alone on NVIDIA's multi-GPU drivers), so it sees
// them all and these settings point it at the one it uses.

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// scaleLabel marks what `scale` made; it touches nothing without it.
const scaleLabel = "at.recorder.scaled-gpu"

// instanceFiles is what a new recorder copies; clips are its own.
var instanceFiles = []string{"home", "home2", "games", "state", "config", "compose.yml", ".env"}

type scaleInstance struct {
	Number     int
	Name       string
	CardUUID   string
	Bus        string
	RenderNode string
	Port       int
	OnCard     int
}

var (
	reContainerName = regexp.MustCompile(`(?m)^([ \t]+)container_name:[ \t]*\S+[ \t]*$`)
	reHostname      = regexp.MustCompile(`(?m)^([ \t]+)hostname:[ \t]*\S+[ \t]*$`)
	reVisible       = regexp.MustCompile(`(?m)^([ \t]+- )NVIDIA_VISIBLE_DEVICES=\S*[ \t]*$`)
	reCompositor    = regexp.MustCompile(`(?m)^([ \t]+- COMPOSITOR_RENDER_DEVICE=)\S*[ \t]*$`)
	reEncoderDRM    = regexp.MustCompile(`(?m)^([ \t]+- ENCODER_RENDER_DEVICE=)/dev/dri/\S*[ \t]*$`)
	rePort          = regexp.MustCompile(`(?m)^([ \t]+- "?)\d+(:8483(?:/udp)?"?)[ \t]*$`)
	reOfflineOff    = regexp.MustCompile(`("WantsOfflineMode"\s+)"0"`)
)

// instanceCompose is the base compose file for this recorder. Every field it
// changes must be there once, or it refuses: a silently unpinned recorder would
// run on the wrong card.
func instanceCompose(base []byte, in scaleInstance) ([]byte, error) {
	s := string(base)
	one := func(re *regexp.Regexp, what, repl string) error {
		if len(re.FindAllString(s, -1)) != 1 {
			return fmt.Errorf("compose.yml needs exactly one %s", what)
		}
		s = re.ReplaceAllString(s, repl)
		return nil
	}
	for _, e := range []error{
		one(reContainerName, "container_name", "${1}container_name: "+in.Name+"\n${1}labels:\n${1}  "+scaleLabel+": "+in.CardUUID),
		one(reHostname, "hostname", "${1}hostname: "+in.Name),
		one(reVisible, "NVIDIA_VISIBLE_DEVICES", "${1}NVIDIA_VISIBLE_DEVICES=all\n${1}DRI_PRIME=pci-"+driPrimeBus(in.Bus)+"\n${1}CUDA_VISIBLE_DEVICES="+in.CardUUID),
		one(reCompositor, "COMPOSITOR_RENDER_DEVICE", "${1}"+in.RenderNode),
	} {
		if e != nil {
			return nil, e
		}
	}
	s = reEncoderDRM.ReplaceAllString(s, "${1}"+in.RenderNode)
	if len(rePort.FindAllString(s, -1)) == 0 {
		return nil, errors.New("compose.yml has no 8483 port")
	}
	s = rePort.ReplaceAllString(s, "${1}"+strconv.Itoa(in.Port)+"${2}")
	return []byte(s), nil
}

// driPrimeBus is a PCI address as DRI_PRIME wants it: 0000:82:00.0 → 0000_82_00_0.
func driPrimeBus(bus string) string {
	return strings.NewReplacer(":", "_", ".", "_").Replace(strings.ToLower(bus))
}

// instanceEnv is the worker's settings for this recorder: its name, its card,
// and no CS2 updates of its own (the first recorder updates).
func instanceEnv(old []byte, in scaleInstance) []byte {
	return withConfig(old, map[string]string{
		"AT_WORKER_NAME":       in.Name,
		"DRI_PRIME":            "pci-" + driPrimeBus(in.Bus),
		"CUDA_VISIBLE_DEVICES": in.CardUUID,
		"AT_RECORDERS_PER_GPU": strconv.Itoa(in.OnCard),
		"AT_CS2_UPDATE":        "0",
	})
}

// parseScaleCards reads nvidia-smi's uuid, pci.bus_id, memory.total, memory.used.
func parseScaleCards(csv string) []scaleCard {
	var cards []scaleCard
	for _, line := range strings.Split(strings.TrimSpace(csv), "\n") {
		f := strings.Split(line, ", ")
		if len(f) != 4 {
			continue
		}
		total, err1 := strconv.Atoi(strings.TrimSpace(f[2]))
		used, err2 := strconv.Atoi(strings.TrimSpace(f[3]))
		if err1 != nil || err2 != nil {
			continue
		}
		// nvidia-smi says 00000000:82:00.0; the kernel and DRI_PRIME say 0000:82:00.0.
		bus := strings.ToLower(f[1])
		if i := strings.Index(bus, ":"); i > 4 {
			bus = bus[i-4:]
		}
		cards = append(cards, scaleCard{UUID: f[0], Bus: bus, TotalMB: total, UsedMB: used})
	}
	return cards
}

// renderNodeOf finds a card's render node under sysDevices (/sys/bus/pci/devices).
func renderNodeOf(sysDevices, bus string) (string, error) {
	m, err := filepath.Glob(filepath.Join(sysDevices, bus, "drm", "renderD*"))
	if err != nil || len(m) != 1 {
		return "", fmt.Errorf("no single render node for GPU %s", bus)
	}
	return "/dev/dri/" + filepath.Base(m[0]), nil
}

func (a *agent) scaleCommand(ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("scale", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	gpu := fs.String("gpu", "", "the card's UUID")
	dryRun := fs.Bool("dry-run", false, "print what it would do")
	fullCopy := fs.Bool("allow-full-copy", false, "copy CS2 in full where the disk has no reflinks")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 || *gpu == "" {
		return errors.New("usage: at-recorder scale --gpu UUID [--dry-run] [--allow-full-copy]")
	}
	smi, err := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=uuid,pci.bus_id,memory.total,memory.used", "--format=csv,noheader,nounits").Output()
	if err != nil {
		return fmt.Errorf("nvidia-smi: %w", err)
	}
	var card *scaleCard
	for _, c := range parseScaleCards(string(smi)) {
		if c.UUID == *gpu {
			c := c
			card = &c
		}
	}
	if card == nil {
		return fmt.Errorf("no GPU %s here", *gpu)
	}
	ps, err := a.run(ctx, "ps", "-a", "--filter", "label="+scaleLabel+"="+*gpu, "--format", "{{.Names}}")
	if err != nil {
		return err
	}
	running := len(strings.Fields(string(ps)))
	if env, err := a.run(ctx, "inspect", "at-recorder", "--format", "{{range .Config.Env}}{{println .}}{{end}}"); err == nil && strings.Contains(string(env), "="+*gpu) {
		running++
	}
	room := scaleRoom(*card, running, nil)
	if room < 1 {
		return fmt.Errorf("no room on this card: %d of %d MB used, %d recorders: another would run out of GPU memory", card.UsedMB, card.TotalMB, running)
	}
	render, err := renderNodeOf("/sys/bus/pci/devices", card.Bus)
	if err != nil {
		return err
	}
	number := 2
	for exists(filepath.Join(a.root, "instances", strconv.Itoa(number))) {
		number++
	}
	in := scaleInstance{Number: number, Name: fmt.Sprintf("%s-%d", a.name, number), CardUUID: *gpu, Bus: card.Bus, RenderNode: render, Port: 8482 + number, OnCard: running + 1}
	base, err := os.ReadFile(filepath.Join(a.root, "compose.yml"))
	if err != nil {
		return err
	}
	compose, err := instanceCompose(base, in)
	if err != nil {
		return err
	}
	dir := filepath.Join(a.root, "instances", strconv.Itoa(number))
	if *dryRun {
		fmt.Fprintf(out, "Would create %s in %s, on %s (%s), web UI port %d, %d of %d MB used.\n\n%s", in.Name, dir, card.Bus, render, in.Port, card.UsedMB, card.TotalMB, compose)
		return nil
	}
	// A running job writes into the home and the game folder: copy between jobs.
	if _, err := a.run(ctx, "exec", "at-recorder", "test", "-f", "/mnt/clips/recorder-idle"); err != nil {
		return errors.New("the recorder is at a job: copy it when it is idle, or disable it in the platform first")
	}
	if err := copyInstance(ctx, a.root, dir, *fullCopy); err != nil {
		_ = os.RemoveAll(dir)
		return err
	}
	if err := finishInstance(a.root, dir, compose, in); err != nil {
		return err
	}
	if _, err := a.run(ctx, "compose", "-f", filepath.Join(dir, "compose.yml"), "--project-directory", dir, "up", "-d"); err != nil {
		return err
	}
	fmt.Fprintf(out, "%s is starting on %s. It shows up in the platform when it connects.\n", in.Name, card.Bus)
	return nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func copyInstance(ctx context.Context, root, dir string, fullCopy bool) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	mode := "--reflink=always"
	if fullCopy {
		mode = "--reflink=auto"
	}
	for _, name := range instanceFiles {
		from := filepath.Join(root, name)
		if !exists(from) {
			continue
		}
		if b, err := exec.CommandContext(ctx, "cp", "-a", mode, from, dir+"/").CombinedOutput(); err != nil {
			if !fullCopy {
				return fmt.Errorf("this disk has no reflink copies, so each recorder needs a full copy of CS2 (use --allow-full-copy): %s", strings.TrimSpace(string(b)))
			}
			return fmt.Errorf("copying %s: %s", name, strings.TrimSpace(string(b)))
		}
	}
	return nil
}

// finishInstance writes the copy's settings. The copy's clips folder must be
// the recorder user's, as the original's, or its worker can't start; its Steam
// stays offline, because a shared account can only be online once.
func finishInstance(root, dir string, compose []byte, in scaleInstance) error {
	if err := os.WriteFile(filepath.Join(dir, "compose.yml"), compose, 0o644); err != nil {
		return err
	}
	clips := filepath.Join(dir, "clips")
	if err := os.MkdirAll(clips, 0o755); err != nil {
		return err
	}
	uid, gid, err := fileOwner(filepath.Join(root, "clips"))
	if err != nil {
		return err
	}
	if err := os.Chown(clips, uid, gid); err != nil {
		return err
	}
	envPath := filepath.Join(dir, "config", "at-recorder.env")
	env, err := os.ReadFile(envPath)
	if err != nil {
		return err
	}
	if err := writeConfig(envPath, instanceEnv(env, in)); err != nil {
		return err
	}
	for _, home := range []string{"home", "home2"} {
		users := filepath.Join(dir, home, ".local/share/Steam/config/loginusers.vdf")
		if b, err := os.ReadFile(users); err == nil {
			if err := os.WriteFile(users, reOfflineOff.ReplaceAll(b, []byte(`$1"1"`)), 0o644); err != nil {
				return err
			}
		}
	}
	return nil
}
