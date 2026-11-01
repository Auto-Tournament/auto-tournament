package main

import (
	"errors"
	"testing"
	"time"
)

func TestEncoderOutOfMemory(t *testing.T) {
	for msg, want := range map[string]bool{
		"ffmpeg: exit status 187 [hevc_nvenc] cuCtxCreate failed -> CUDA_ERROR_OUT_OF_MEMORY: out of memory": true,
		"ffmpeg: exit status 244 [hevc_nvenc] CreateInputBuffer failed: out of memory (10):":                 true,
		"ffmpeg: exit status 1 No such file or directory":                                                    false,
	} {
		if got := encoderOutOfMemory(errors.New(msg)); got != want {
			t.Errorf("%q: %v", msg, got)
		}
	}
	if encoderOutOfMemory(nil) {
		t.Error("nil")
	}
}

func TestRetryOutOfGPUMemory(t *testing.T) {
	oom, other := errors.New("CUDA_ERROR_OUT_OF_MEMORY"), errors.New("broken")
	waits := []time.Duration{time.Second, 2 * time.Second}
	cases := []struct {
		name  string
		first error
		next  []error
		want  error
		tries int
		slept int
	}{
		{"a good encode isn't retried", nil, nil, nil, 0, 0},
		{"another error isn't retried", other, nil, other, 0, 0},
		{"memory comes back", oom, []error{nil}, nil, 1, 1},
		{"gives up after the waits", oom, []error{oom, oom}, oom, 2, 2},
		{"a new kind of error stops it", oom, []error{other}, other, 1, 1},
	}
	for _, c := range cases {
		tries, slept := 0, 0
		got := retryOutOfGPUMemory(c.first, "clip.mp4", waits, func(time.Duration) { slept++ }, func() error {
			tries++
			return c.next[tries-1]
		})
		if !errors.Is(got, c.want) || tries != c.tries || slept != c.slept {
			t.Errorf("%s: err %v, %d tries, %d waits", c.name, got, tries, slept)
		}
	}
}
