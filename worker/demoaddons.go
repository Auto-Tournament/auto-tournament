package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
)

// A CS2 demo starts with "PBDEMS2\0", the absolute offsets of two frames near
// its end (file info, spawn groups) as int32s, then the DEM_FileHeader frame:
// command, tick and size as varints, then the CDemoFileHeader message.
var demoMagic = []byte("PBDEMS2\x00")

const (
	demFileHeader   = 1
	demIsCompressed = 0x40
	headerAddons    = 10 // CDemoFileHeader.addons: the workshop items the server ran
)

// copyDemoWithoutAddons copies a demo for CS2 to play with its header's
// addons emptied, as a server without any writes it. A server running a
// client addon (the Auto Tournament HUD, workshop 3827905393) lists it there,
// and the recorder's CS2, offline, can't fetch it: the demo's map loads but
// it never plays (2026-10-27, "the demo never reported its first tick"). The
// clips don't show the HUD anyway. Anything that isn't such a header is
// copied as it is.
func copyDemoWithoutAddons(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	r := bufio.NewReaderSize(in, 1<<16)
	head, rewritten, err := demoHeadWithoutAddons(r)
	if err != nil {
		return err
	}
	if !rewritten {
		// Nothing to change: the whole file from its first byte.
		if _, err := in.Seek(0, io.SeekStart); err != nil {
			return err
		}
		r.Reset(in)
	}
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := out.Write(head); err == nil {
		_, err = io.Copy(out, r)
	}
	if err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// demoHeadWithoutAddons reads a demo's start (magic, offsets, header frame)
// from r and returns it rewritten with the addons emptied and both offsets
// moved by what that removed; rewritten is false when there is nothing to do.
func demoHeadWithoutAddons(r *bufio.Reader) (head []byte, rewritten bool, err error) {
	start := make([]byte, 16)
	if _, err := io.ReadFull(r, start); err != nil || !bytes.Equal(start[:8], demoMagic) {
		return nil, false, nil
	}
	cmd, cmdRaw, err := readVarint(r)
	if err != nil || cmd != demFileHeader { // also skips a compressed header (cmd|0x40)
		return nil, false, nil
	}
	_, tickRaw, err := readVarint(r)
	if err != nil {
		return nil, false, nil
	}
	size, sizeRaw, err := readVarint(r)
	if err != nil || size > 1<<20 {
		return nil, false, nil
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, false, err
	}
	trimmed, removed := withoutField(payload, headerAddons)
	if removed == 0 {
		return nil, false, nil
	}
	frame := append(append(append([]byte{}, cmdRaw...), tickRaw...), binary.AppendUvarint(nil, uint64(len(trimmed)))...)
	frame = append(frame, trimmed...)
	delta := int32(len(frame) - (len(cmdRaw) + len(tickRaw) + len(sizeRaw) + len(payload)))
	for _, at := range []int{8, 12} {
		if off := int32(binary.LittleEndian.Uint32(start[at:])); off > 0 {
			binary.LittleEndian.PutUint32(start[at:], uint32(off+delta))
		}
	}
	return append(start, frame...), true, nil
}

// withoutField returns a protobuf message with length-delimited field `field`
// emptied (its tag kept, length 0) and how many bytes that removed; the
// message as it is (0) when the field is absent, already empty or the message
// can't be read.
func withoutField(msg []byte, field uint64) ([]byte, int) {
	var out []byte
	removed := 0
	for i := 0; i < len(msg); {
		tag, n := binary.Uvarint(msg[i:])
		if n <= 0 {
			return msg, 0
		}
		j := i + n
		switch tag & 7 {
		case 0:
			_, m := binary.Uvarint(msg[j:])
			if m <= 0 {
				return msg, 0
			}
			j += m
		case 1:
			j += 8
		case 5:
			j += 4
		case 2:
			l, m := binary.Uvarint(msg[j:])
			if m <= 0 || j+m+int(l) > len(msg) {
				return msg, 0
			}
			if tag>>3 == field && l > 0 {
				out = append(append(out, msg[i:j]...), 0)
				removed += m + int(l) - 1
				i = j + m + int(l)
				continue
			}
			j += m + int(l)
		default:
			return msg, 0
		}
		if j > len(msg) {
			return msg, 0
		}
		out = append(out, msg[i:j]...)
		i = j
	}
	return out, removed
}

// readVarint reads one varint, returning its value and its bytes as read.
func readVarint(r *bufio.Reader) (uint64, []byte, error) {
	var raw []byte
	for len(raw) < binary.MaxVarintLen64 {
		b, err := r.ReadByte()
		if err != nil {
			return 0, nil, err
		}
		raw = append(raw, b)
		if b < 0x80 {
			v, _ := binary.Uvarint(raw)
			return v, raw, nil
		}
	}
	return 0, nil, errors.New("varint too long")
}
