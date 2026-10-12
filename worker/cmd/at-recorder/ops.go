package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// updateInfo is the platform's answer to update/available.
type updateInfo struct {
	Managed bool   `json:"managed"`
	Status  string `json:"status"`
	Error   string `json:"error"`
	Image   struct {
		Installed string `json:"installed"`
		Latest    string `json:"latest"`
		Newer     bool   `json:"newer"`
	} `json:"image"`
	Agent struct {
		Installed string `json:"installed"`
		Latest    string `json:"latest"`
		Newer     bool   `json:"newer"`
	} `json:"agent"`
}

func (u updateInfo) newer() bool { return u.Image.Newer || u.Agent.Newer }

// running: the platform has an update for this host in hand.
func (u updateInfo) running() bool { return u.Status == "queued" || u.Status == "updating" }

func (u updateInfo) describe() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Recorder image: %s", orNone(u.Image.Installed))
	if u.Image.Newer {
		fmt.Fprintf(&b, " → %s", u.Image.Latest)
	}
	fmt.Fprintf(&b, "\nHost agent: %s", orNone(u.Agent.Installed))
	if u.Agent.Newer {
		fmt.Fprintf(&b, " → %s", u.Agent.Latest)
	}
	fmt.Fprintf(&b, "\nUpdate status: %s", u.Status)
	if u.Error != "" {
		fmt.Fprintf(&b, " (%s)", u.Error)
	}
	return b.String()
}

func orNone(s string) string {
	if s == "" {
		return "unknown"
	}
	return s
}

// updateCommand is `at-recorder update [--check] [--no-wait]`: the same
// update as the platform's Update button (pinned release, the current job
// finishes first, rolled back if the new one does not start), asked for from
// the host. It follows the update until it is done unless --no-wait.
func (a *agent) updateCommand(ctx context.Context, args []string, out io.Writer, poll time.Duration, limit time.Duration) error {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	check := fs.Bool("check", false, "only say whether an update is available")
	noWait := fs.Bool("no-wait", false, "ask for the update and return")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 {
		return errors.New("usage: at-recorder update [--check] [--no-wait]")
	}
	var u updateInfo
	if err := a.apiPath(ctx, "update/available", nil, &u); err != nil {
		return err
	}
	fmt.Fprintln(out, u.describe())
	if *check {
		switch {
		case u.running():
			fmt.Fprintln(out, "An update is already under way.")
		case u.newer():
			fmt.Fprintln(out, "An update is available: at-recorder update")
		default:
			fmt.Fprintln(out, "Up to date.")
		}
		return nil
	}
	if !u.running() {
		if !u.newer() {
			fmt.Fprintln(out, "Up to date.")
			return nil
		}
		if !u.Managed {
			return errors.New("the host agent is not taking managed updates: check `systemctl status at-recorder-agent` (adopt with `at-recorder setup --adopt`)")
		}
		var q struct {
			Queued int `json:"queued"`
		}
		if err := a.apiPath(ctx, "update/request", map[string]string{}, &q); err != nil {
			return err
		}
		if q.Queued == 0 {
			return errors.New("the platform did not queue an update (already current, or the agent was not seen in the last 5 minutes)")
		}
		fmt.Fprintln(out, "Update requested. The current job finishes first; new jobs wait.")
	}
	if *noWait {
		return nil
	}
	deadline := time.Now().Add(limit)
	last := ""
	for time.Now().Before(deadline) {
		if err := a.wait(ctx, poll); err != nil {
			return err
		}
		if err := a.apiPath(ctx, "update/available", nil, &u); err != nil {
			fmt.Fprintf(out, "(platform not reachable: %v)\n", err)
			continue
		}
		if u.Status != last {
			fmt.Fprintf(out, "%s %s\n", time.Now().Format("15:04:05"), u.Status)
			last = u.Status
		}
		switch u.Status {
		case "current":
			fmt.Fprintln(out, u.describe())
			fmt.Fprintln(out, "Updated.")
			return nil
		case "failed":
			return fmt.Errorf("update failed: %s", orNone(u.Error))
		}
	}
	return errors.New("still not done after the wait; follow it with `at-recorder update --check` or the platform's Recorders page")
}

// secretLike is what a log line must not show: recorder keys, and anything
// set as a token, key, password or secret.
var secretLike = regexp.MustCompile(`(?i)(atr_[A-Za-z0-9_-]+|((token|key|password|passwd|secret|pass)[A-Za-z_]*\s*[=:]\s*)\S+)`)

func scrubSecrets(s string) string {
	return secretLike.ReplaceAllStringFunc(s, func(m string) string {
		if sub := secretLike.FindStringSubmatch(m); len(sub) > 2 && sub[2] != "" {
			return sub[2] + "***"
		}
		return "***"
	})
}

// logSources are what `at-recorder logs` shows: the host agent's journal
// and the worker's (a user service inside the recorder container).
func logSources(lines int, follow bool) [][]string {
	n := fmt.Sprint(lines)
	agent := []string{"journalctl", "-u", "at-recorder-agent", "-n", n, "--no-pager", "-o", "short-iso"}
	worker := []string{"docker", "exec", "at-recorder", "journalctl", "_SYSTEMD_USER_UNIT=at-recorder.service", "-n", n, "--no-pager", "-o", "short-iso"}
	if follow {
		agent = append(agent, "-f")
		worker = append(worker, "-f")
	}
	return [][]string{agent, worker}
}

// logsCommand is `at-recorder logs [-f] [-n LINES]`.
func logsCommand(ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	follow := fs.Bool("f", false, "keep following")
	lines := fs.Int("n", 100, "lines from each log")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 || *lines < 1 {
		return errors.New("usage: at-recorder logs [-f] [-n LINES]")
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, src := range logSources(*lines, *follow) {
		prefix := [...]string{"[agent] ", "[worker] "}[i]
		wg.Add(1)
		go func(i int, src []string) {
			defer wg.Done()
			cmd := exec.CommandContext(ctx, src[0], src[1:]...)
			pipe, err := cmd.StdoutPipe()
			if err != nil {
				errs[i] = err
				return
			}
			cmd.Stderr = cmd.Stdout
			if err := cmd.Start(); err != nil {
				errs[i] = err
				return
			}
			sc := bufio.NewScanner(pipe)
			sc.Buffer(make([]byte, 64*1024), 1024*1024)
			for sc.Scan() {
				mu.Lock()
				fmt.Fprintln(out, prefix+scrubSecrets(sc.Text()))
				mu.Unlock()
			}
			errs[i] = cmd.Wait()
		}(i, src)
	}
	wg.Wait()
	if errs[0] != nil && errs[1] != nil {
		return fmt.Errorf("no log could be read: %v; %v", errs[0], errs[1])
	}
	return nil
}

// restartCommand is `at-recorder restart [--force] [--yes]`: the worker
// service, only while it is idle. --force restarts mid-job (that job's clips
// go back to the platform) after a confirmation, or --yes.
func (a *agent) restartCommand(ctx context.Context, args []string, in io.Reader, out io.Writer) error {
	fs := flag.NewFlagSet("restart", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	force := fs.Bool("force", false, "restart even mid-job")
	yes := fs.Bool("yes", false, "do not ask")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 {
		return errors.New("usage: at-recorder restart [--force] [--yes]")
	}
	_, idleErr := a.run(ctx, "exec", "at-recorder", "test", "-f", "/mnt/clips/recorder-idle")
	if idleErr != nil {
		if !*force {
			return errors.New("the recorder is at a job: wait for it (or disable it in the platform and let it finish), or use --force")
		}
		if !*yes {
			fmt.Fprint(out, "The recorder is at a job; restarting gives its clips back to the platform. Type yes to restart: ")
			answer, _ := bufio.NewReader(in).ReadString('\n')
			if strings.TrimSpace(strings.ToLower(answer)) != "yes" {
				return errors.New("not restarted")
			}
		}
	}
	if _, err := a.run(ctx, "exec", "-u", "99", "at-recorder", "sh", "-c",
		"XDG_RUNTIME_DIR=/run/user/99 systemctl --user restart at-recorder"); err != nil {
		return err
	}
	fmt.Fprintln(out, "Recorder restarted.")
	return nil
}

// stdinOrTTY is where restart's confirmation is read: the terminal when stdin is not one.
func stdinOrTTY() io.Reader {
	if tty, err := os.Open("/dev/tty"); err == nil {
		return tty
	}
	return os.Stdin
}
