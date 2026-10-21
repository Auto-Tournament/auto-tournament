package main

import "testing"

func TestRecorderJobTimeoutConfiguration(t *testing.T) {
	for _, value := range []string{"", "0", "-1", "1.5", "invalid", "999999999999999999999999", "21600"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("AT_RECORDER_JOB_SECONDS", value)
			want := 45 * 60
			if value == "21600" {
				want = 21600
			}
			if got := envPositive("AT_RECORDER_JOB_SECONDS", 45*60); got != want {
				t.Fatalf("job timeout = %d, want %d", got, want)
			}
		})
	}
}
