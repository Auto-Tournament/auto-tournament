package main

import (
	"log"
	"os/exec"
	"sync"

	"github.com/godbus/dbus/v5"
)

// awake keeps the PC from sleeping while the recorder has work (a recorder
// is often a gaming PC that suspends when no one touches it), and lets go
// when it waits for work again. Over the session bus, which a container
// reaches through the mounted /run/user/<uid>:
//
//  1. the desktop's own power management (KDE, GNOME, Xfce): the inhibitor
//     lasts as long as our connection;
//  2. else the user's systemd runs systemd-inhibit as a unit of the user's
//     session (Hyprland and other shells that suspend through logind):
//     polkit lets a logged-in user's session block sleep, where a process in
//     a container is refused;
//
// else a systemd-inhibit of our own (bare metal). AT_KEEP_AWAKE=0 turns it off.
type awake struct {
	mu     sync.Mutex
	bus    *dbus.Conn
	cookie uint32
	via    inhibitor // the interface the cookie belongs to
	unit   bool      // the user's systemd runs awakeUnit
	cmd    *exec.Cmd
	warned bool
}

type inhibitor struct{ dest, path, iface string }

// awakeUnit is the user's systemd unit that holds the sleep lock (2. above).
const awakeUnit = "at-recorder-awake.service"

type execStart struct {
	Path          string
	Args          []string
	IgnoreFailure bool
}

type unitProperty struct {
	Name  string
	Value dbus.Variant
}

// startAwakeUnit asks the user's systemd to run systemd-inhibit until it is stopped.
func startAwakeUnit(bus *dbus.Conn) error {
	inhibit := "/usr/bin/systemd-inhibit"
	props := []unitProperty{
		{"Description", dbus.MakeVariant("Auto Tournament recorder: no sleep while recording")},
		{"ExecStart", dbus.MakeVariant([]execStart{{inhibit, []string{inhibit, "--what=sleep:idle",
			"--who=Auto Tournament recorder", "--why=Recording highlights", "--mode=block", "sleep", "infinity"}, false}})},
	}
	var job dbus.ObjectPath
	return bus.Object("org.freedesktop.systemd1", "/org/freedesktop/systemd1").Call(
		"org.freedesktop.systemd1.Manager.StartTransientUnit", 0, awakeUnit, "replace", props,
		[]struct {
			Name  string
			Props []unitProperty
		}{}).Store(&job)
}

// sessionInhibitors are the desktop interfaces that hold off sleep, best first.
var sessionInhibitors = []inhibitor{
	{"org.freedesktop.PowerManagement", "/org/freedesktop/PowerManagement/Inhibit", "org.freedesktop.PowerManagement.Inhibit"},
	{"org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver", "org.freedesktop.ScreenSaver"},
}

func (a *awake) hold() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.bus != nil || a.cmd != nil || env("AT_KEEP_AWAKE", "1") == "0" {
		return
	}
	if bus, err := dbus.ConnectSessionBus(); err == nil {
		for _, in := range sessionInhibitors {
			var cookie uint32
			if err := bus.Object(in.dest, dbus.ObjectPath(in.path)).Call(in.iface+".Inhibit", 0,
				"Auto Tournament recorder", "Recording highlights").Store(&cookie); err == nil {
				a.bus, a.cookie, a.via = bus, cookie, in
				return
			}
		}
		if err := startAwakeUnit(bus); err == nil {
			a.bus, a.unit = bus, true
			return
		}
		bus.Close()
	}
	cmd := exec.Command("systemd-inhibit", "--what=sleep:idle", "--who=Auto Tournament recorder",
		"--why=Recording highlights", "--mode=block", "sleep", "infinity")
	if err := cmd.Start(); err != nil {
		a.warn(err)
		return
	}
	a.cmd = cmd
	go func(c *exec.Cmd) {
		err := c.Wait()
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.cmd == c {
			a.cmd = nil
			if err != nil {
				a.warn(err)
			}
		}
	}(cmd)
}

// warn says once that the PC may sleep mid-job.
func (a *awake) warn(err error) {
	if a.warned {
		return
	}
	a.warned = true
	log.Printf("cannot keep the PC awake while recording (%v): it may sleep in the middle of a job", err)
}

func (a *awake) release() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.bus != nil {
		if a.unit {
			var job dbus.ObjectPath
			_ = a.bus.Object("org.freedesktop.systemd1", "/org/freedesktop/systemd1").Call(
				"org.freedesktop.systemd1.Manager.StopUnit", 0, awakeUnit, "replace").Store(&job)
			a.unit = false
		} else {
			_ = a.bus.Object(a.via.dest, dbus.ObjectPath(a.via.path)).Call(a.via.iface+".UnInhibit", 0, a.cookie).Err
		}
		a.bus.Close()
		a.bus = nil
	}
	if a.cmd != nil && a.cmd.Process != nil {
		c := a.cmd
		a.cmd = nil
		_ = c.Process.Kill()
	}
}
