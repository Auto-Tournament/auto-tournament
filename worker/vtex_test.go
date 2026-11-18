package main

import (
	"encoding/binary"
	"testing"

	"github.com/pierrec/lz4/v4"
)

// A two-mip BGRA texture laid out as CS2 ships skin previews: the
// COMPRESSED_MIP_SIZE list runs largest mip first, the data smallest first.
func TestDecodeVtexTwoMips(t *testing.T) {
	const w, h = 8, 8
	big := make([]byte, w*h*4)
	for i := range big {
		big[i] = byte(i)
	}
	small := make([]byte, (w/2)*(h/2)*4)
	compress := func(src []byte) []byte {
		dst := make([]byte, lz4.CompressBlockBound(len(src)))
		n, err := lz4.CompressBlock(src, dst, nil)
		if err != nil || n == 0 {
			t.Fatalf("compress: %d %v", n, err)
		}
		return dst[:n]
	}
	cBig, cSmall := compress(big), compress(small)

	le := binary.LittleEndian
	const header = 256
	d := make([]byte, header)
	le.PutUint32(d[0:], header) // file size: the mips follow the header
	le.PutUint32(d[8:], 8)      // block table at 16
	le.PutUint32(d[12:], 1)
	copy(d[16:], "DATA")
	le.PutUint32(d[20:], 64-20) // DATA at 64
	data := 64
	le.PutUint16(d[data+20:], w)
	le.PutUint16(d[data+22:], h)
	d[data+26] = vtexBGRA8888
	d[data+27] = 2
	le.PutUint32(d[data+32:], 16) // extra data table at data+48
	le.PutUint32(d[data+36:], 1)
	p := data + 48
	le.PutUint32(d[p:], 4)      // COMPRESSED_MIP_SIZE
	le.PutUint32(d[p+4:], 32-4) // its payload at p+32
	le.PutUint32(d[p+32:], 1)   // version
	le.PutUint32(d[p+36:], 8)   // sizes at p+32+4+8
	le.PutUint32(d[p+40:], 2)   // count
	le.PutUint32(d[p+44:], uint32(len(cBig)))
	le.PutUint32(d[p+48:], uint32(len(cSmall)))
	d = append(append(d, cSmall...), cBig...)

	img, err := DecodeVtex(d)
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != w || img.Pix[0] != big[2] || img.Pix[2] != big[0] || img.Pix[3] != big[3] {
		t.Fatalf("got %v %v", img.Bounds(), img.Pix[:4])
	}
}
