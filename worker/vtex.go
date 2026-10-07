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
	vtexDXT1     = 1
	vtexDXT5     = 2
	vtexRGBA8888 = 4
	vtexBGRA8888 = 28
)

// mipBytes is the size of one mip level of a w x h texture in a format.
func mipBytes(format byte, w, h int) int {
	bw, bh := max(1, (w+3)/4), max(1, (h+3)/4)
	switch format {
	case vtexDXT1:
		return bw * bh * 8
	case vtexDXT5:
		return bw * bh * 16
	}
	return w * h * 4
}

// DecodeVtex reads the top mip of a compiled Source 2 texture (`.vtex_c`)
// stored as 8-bit RGBA or BGRA, or DXT1/DXT5 blocks, raw or LZ4-compressed,
// as radar images are.
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
	if format != vtexRGBA8888 && format != vtexBGRA8888 && format != vtexDXT1 && format != vtexDXT5 {
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
	want := mipBytes(format, w, h)
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
			offset += mipBytes(format, max(1, w>>m), max(1, h>>m))
		}
		if offset+want > len(d) {
			return nil, errors.New("vtex: truncated")
		}
		pixels = d[offset : offset+want]
	}

	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	switch format {
	case vtexDXT1, vtexDXT5:
		decodeBC(img, pixels, format == vtexDXT5)
		return img, nil
	}
	copy(img.Pix, pixels)
	if format == vtexBGRA8888 {
		for i := 0; i+3 < len(img.Pix); i += 4 {
			img.Pix[i], img.Pix[i+2] = img.Pix[i+2], img.Pix[i]
		}
	}
	return img, nil
}

// decodeBC unpacks DXT1 (BC1) or DXT5 (BC3) blocks into img.
func decodeBC(img *image.NRGBA, data []byte, dxt5 bool) {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	size := 8
	if dxt5 {
		size = 16
	}
	i := 0
	for by := 0; by < (h+3)/4; by++ {
		for bx := 0; bx < (w+3)/4; bx++ {
			if i+size > len(data) {
				return
			}
			b := data[i : i+size]
			i += size
			var alpha [16]uint8
			for k := range alpha {
				alpha[k] = 255
			}
			if dxt5 {
				a0, a1 := uint16(b[0]), uint16(b[1])
				var pal [8]uint16
				pal[0], pal[1] = a0, a1
				if a0 > a1 {
					for k := uint16(1); k < 7; k++ {
						pal[k+1] = ((7-k)*a0 + k*a1) / 7
					}
				} else {
					for k := uint16(1); k < 5; k++ {
						pal[k+1] = ((5-k)*a0 + k*a1) / 5
					}
					pal[6], pal[7] = 0, 255
				}
				bits := uint64(b[2]) | uint64(b[3])<<8 | uint64(b[4])<<16 | uint64(b[5])<<24 | uint64(b[6])<<32 | uint64(b[7])<<40
				for k := 0; k < 16; k++ {
					alpha[k] = uint8(pal[(bits>>(3*k))&7])
				}
				b = b[8:]
			}
			c0 := binary.LittleEndian.Uint16(b[0:])
			c1 := binary.LittleEndian.Uint16(b[2:])
			rgb := func(c uint16) [3]int {
				return [3]int{int(c>>11&31) * 255 / 31, int(c>>5&63) * 255 / 63, int(c&31) * 255 / 31}
			}
			p0, p1 := rgb(c0), rgb(c1)
			var cols [4][4]int
			cols[0] = [4]int{p0[0], p0[1], p0[2], 255}
			cols[1] = [4]int{p1[0], p1[1], p1[2], 255}
			if c0 > c1 || dxt5 {
				for ch := 0; ch < 3; ch++ {
					cols[2][ch] = (2*p0[ch] + p1[ch]) / 3
					cols[3][ch] = (p0[ch] + 2*p1[ch]) / 3
				}
				cols[2][3], cols[3][3] = 255, 255
			} else {
				for ch := 0; ch < 3; ch++ {
					cols[2][ch] = (p0[ch] + p1[ch]) / 2
				}
				cols[2][3] = 255
				cols[3] = [4]int{0, 0, 0, 0}
			}
			idx := binary.LittleEndian.Uint32(b[4:])
			for k := 0; k < 16; k++ {
				x, y := bx*4+k%4, by*4+k/4
				if x >= w || y >= h {
					continue
				}
				c := cols[(idx>>(2*k))&3]
				o := img.PixOffset(x, y)
				img.Pix[o], img.Pix[o+1], img.Pix[o+2] = uint8(c[0]), uint8(c[1]), uint8(c[2])
				if dxt5 {
					img.Pix[o+3] = alpha[k]
				} else {
					img.Pix[o+3] = uint8(c[3])
				}
			}
		}
	}
}
