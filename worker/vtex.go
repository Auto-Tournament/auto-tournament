package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"image"

	"github.com/pierrec/lz4/v4"
)

// Texture formats of a Source 2 texture (vtex_c) this decoder reads: the
// ones radar images use.
const (
	vtexRGBA8888 = 4
	vtexBGRA8888 = 28
)

// DecodeVtex reads the top mip of a compiled Source 2 texture (`.vtex_c`)
// stored as 8-bit RGBA or BGRA, raw or LZ4-compressed, as radar images are.
func DecodeVtex(d []byte) (*image.NRGBA, error) {
	if len(d) < 16 {
		return nil, errors.New("vtex: too short")
	}
	le := binary.LittleEndian
	fileSize := int(le.Uint32(d[0:]))
	blockOffset := int(le.Uint32(d[8:]))
	blockCount := int(le.Uint32(d[12:]))
	base := 8 + blockOffset
	data := -1
	for i := 0; i < blockCount; i++ {
		p := base + i*12
		if p+12 > len(d) {
			break
		}
		if string(d[p:p+4]) == "DATA" {
			data = p + 4 + int(le.Uint32(d[p+4:]))
		}
	}
	if data < 0 || data+40 > len(d) {
		return nil, errors.New("vtex: no DATA block")
	}
	w := int(le.Uint16(d[data+20:]))
	h := int(le.Uint16(d[data+22:]))
	format := d[data+26]
	mips := int(d[data+27])
	if format != vtexRGBA8888 && format != vtexBGRA8888 {
		return nil, fmt.Errorf("vtex: format %d is not supported", format)
	}
	// Extra data: type 4 lists the LZ4-compressed size of each mip, smallest first.
	extraOffset := int(le.Uint32(d[data+32:]))
	extraCount := int(le.Uint32(d[data+36:]))
	var compressed []int
	p := data + 32 + extraOffset
	for i := 0; i < extraCount && p+12 <= len(d); i, p = i+1, p+12 {
		typ := le.Uint32(d[p:])
		at := p + 4 + int(le.Uint32(d[p+4:]))
		if typ == 4 && at+12 <= len(d) && le.Uint32(d[at:]) == 1 {
			count := int(le.Uint32(d[at+8:]))
			sizes := at + 4 + int(le.Uint32(d[at+4:]))
			for j := 0; j < count && sizes+4*j+4 <= len(d); j++ {
				compressed = append(compressed, int(le.Uint32(d[sizes+4*j:])))
			}
		}
	}

	// Mips follow the header block, smallest first; the full-size one is last.
	offset := fileSize
	want := w * h * 4
	var pixels []byte
	if len(compressed) == mips && mips > 0 {
		for _, n := range compressed[:mips-1] {
			offset += n
		}
		last := compressed[mips-1]
		if offset+last > len(d) {
			return nil, errors.New("vtex: truncated")
		}
		pixels = make([]byte, want)
		n, err := lz4.UncompressBlock(d[offset:offset+last], pixels)
		if err != nil {
			return nil, fmt.Errorf("vtex: lz4: %w", err)
		}
		if n != want {
			return nil, fmt.Errorf("vtex: got %d bytes, want %d", n, want)
		}
	} else {
		for m := mips - 1; m > 0; m-- {
			offset += (w >> m) * (h >> m) * 4
		}
		if offset+want > len(d) {
			return nil, errors.New("vtex: truncated")
		}
		pixels = d[offset : offset+want]
	}

	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	copy(img.Pix, pixels)
	if format == vtexBGRA8888 {
		for i := 0; i+3 < len(img.Pix); i += 4 {
			img.Pix[i], img.Pix[i+2] = img.Pix[i+2], img.Pix[i]
		}
	}
	return img, nil
}
