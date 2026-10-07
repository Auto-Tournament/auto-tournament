//go:build !linux

package main

import (
	"context"
	"errors"
	"time"
)

// The recorder captures CS2 through gamescope, which is Linux only.
var errRecorderLinuxOnly = errors.New("the highlight recorder runs on Linux (it captures CS2 through gamescope)")

func runRecorder(context.Context, *client, time.Duration) error { return errRecorderLinuxOnly }

func recordFile([]string) error { return errRecorderLinuxOnly }
