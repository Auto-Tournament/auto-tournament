package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// partSize is the most one request carries: Cloudflare turns down request
// bodies over 100 MB, and a 1440p120 clip can be bigger
// (api/src/integrations/cs2/demos/uploadParts.ts).
var partSize int64 = 64 << 20

// uploadWaits is how long a failed upload waits before each new try: a
// platform restart (a deploy) drops the connection or answers 502 for a few
// seconds, and a clip lost to it had to be recorded again (2026-10-20, an
// http2 stream error the request could not be retried after).
var uploadWaits = []time.Duration{5 * time.Second, 15 * time.Second, 30 * time.Second}

// retrying sends a request again, built anew by send, while the connection
// drops or the platform answers 502, 503 or 504.
func retrying(ctx context.Context, send func() (*http.Response, error)) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		res, err := send()
		transient := err != nil ||
			res.StatusCode == http.StatusBadGateway ||
			res.StatusCode == http.StatusServiceUnavailable ||
			res.StatusCode == http.StatusGatewayTimeout
		if !transient || attempt >= len(uploadWaits) || ctx.Err() != nil {
			return res, err
		}
		if res != nil {
			res.Body.Close()
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(uploadWaits[attempt]):
		}
	}
}

// sendFile PUTs a file to route. A file bigger than partSize goes up in parts
// first and the PUT then names it with X-AT-Upload instead of carrying it; a
// platform without parts (404) gets the whole file in one request.
func (c *client) sendFile(ctx context.Context, path, route, contentType string, headers map[string]string) (*http.Response, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > partSize {
		id, err := c.sendParts(ctx, f, info.Size(), filepath.Base(path))
		if err != nil {
			return nil, err
		}
		if id != "" {
			with := map[string]string{"X-AT-Upload": id}
			for k, v := range headers {
				with[k] = v
			}
			return retrying(ctx, func() (*http.Response, error) {
				return c.doWith(ctx, http.MethodPut, route, contentType, http.NoBody, with)
			})
		}
	}
	// A reader of its own for each try: the client closes the body it sent.
	return retrying(ctx, func() (*http.Response, error) {
		return c.doWith(ctx, http.MethodPut, route, contentType, io.NewSectionReader(f, 0, info.Size()), headers)
	})
}

// sendParts sends the file in parts and gives its upload id, or "" when the
// platform takes no parts.
func (c *client) sendParts(ctx context.Context, f *os.File, size int64, name string) (string, error) {
	res, err := c.do(ctx, http.MethodPost, "/api/game/cs2/recorder/uploads", "application/json", http.NoBody)
	if err != nil {
		return "", err
	}
	if res.StatusCode == http.StatusNotFound {
		res.Body.Close()
		return "", nil
	}
	if err := ok(res, "start upload of "+name); err != nil {
		res.Body.Close()
		return "", err
	}
	var started struct {
		ID string `json:"id"`
	}
	err = json.NewDecoder(res.Body).Decode(&started)
	res.Body.Close()
	if err != nil || started.ID == "" {
		return "", fmt.Errorf("start upload of %s: no id", name)
	}
	for offset := int64(0); offset < size; {
		n := min(partSize, size-offset)
		route := fmt.Sprintf("/api/game/cs2/recorder/uploads/%s?offset=%d", started.ID, offset)
		res, err := retrying(ctx, func() (*http.Response, error) {
			return c.doWith(ctx, http.MethodPut, route, "application/octet-stream", io.NewSectionReader(f, offset, n), nil)
		})
		if err != nil {
			return "", err
		}
		err = ok(res, fmt.Sprintf("upload %s (part at %d)", name, offset))
		res.Body.Close()
		if err != nil {
			return "", err
		}
		offset += n
	}
	return started.ID, nil
}
