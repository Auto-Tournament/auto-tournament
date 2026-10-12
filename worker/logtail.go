package main

import (
	"os"
	"regexp"
	"strings"
)

// secretLike is what a log line must not carry into a report: recorder keys,
// and anything set as a token, key, password or secret.
var secretLike = regexp.MustCompile(`(?i)(atr_[A-Za-z0-9_-]+|((token|key|password|passwd|secret|pass)[A-Za-z_]*\s*[=:]\s*)\S+)`)

// scrubSecrets hides secret-looking values in a line.
func scrubSecrets(s string) string {
	return secretLike.ReplaceAllStringFunc(s, func(m string) string {
		if sub := secretLike.FindStringSubmatch(m); len(sub) > 2 && sub[2] != "" {
			return sub[2] + "***"
		}
		return "***"
	})
}

// logTail is a log file's last lines (at most n, and at most max bytes),
// scrubbed of secrets; "" when it cannot be read.
func logTail(path string, n, max int) string {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return ""
	}
	if len(b) > 256*1024 {
		b = b[len(b)-256*1024:]
	}
	lines := strings.Split(strings.TrimRight(string(b), "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	out := scrubSecrets(strings.Join(lines, "\n"))
	if len(out) > max {
		out = out[len(out)-max:]
	}
	return out
}
