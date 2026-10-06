package main

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// vpkEntry is one file in a Valve package (VPK v1/v2): where its bytes are.
type vpkEntry struct {
	archive  uint16 // 0x7fff: in the _dir file itself, after the tree
	offset   uint32
	length   uint32
	preload  []byte
	crc      uint32
	dirFile  string
	treeEnd  int64
	basePath string // the _dir file without "_dir.vpk"
}

// VPK is a package's directory: path -> entry.
type VPK struct {
	files map[string]vpkEntry
}

func readCString(r *bufio.Reader) (string, error) {
	s, err := r.ReadString(0)
	if err != nil {
		return "", err
	}
	return s[:len(s)-1], nil
}

// OpenVPK reads the directory of a `*_dir.vpk` (or a single-file .vpk).
func OpenVPK(dirFile string) (*VPK, error) {
	f, err := os.Open(dirFile)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var head struct {
		Signature, Version, TreeSize uint32
	}
	if err := binary.Read(f, binary.LittleEndian, &head); err != nil {
		return nil, err
	}
	if head.Signature != 0x55aa1234 {
		return nil, errors.New("not a VPK")
	}
	headerSize := int64(12)
	if head.Version == 2 {
		headerSize = 28
		if _, err := f.Seek(16, io.SeekCurrent); err != nil {
			return nil, err
		}
	}
	r := bufio.NewReader(f)
	v := &VPK{files: map[string]vpkEntry{}}
	base := strings.TrimSuffix(strings.TrimSuffix(dirFile, ".vpk"), "_dir")
	for {
		ext, err := readCString(r)
		if err != nil || ext == "" {
			break
		}
		for {
			dir, err := readCString(r)
			if err != nil || dir == "" {
				break
			}
			for {
				name, err := readCString(r)
				if err != nil || name == "" {
					break
				}
				var meta struct {
					CRC          uint32
					PreloadBytes uint16
					Archive      uint16
					Offset       uint32
					Length       uint32
					Terminator   uint16
				}
				if err := binary.Read(r, binary.LittleEndian, &meta); err != nil {
					return nil, err
				}
				pre := make([]byte, meta.PreloadBytes)
				if _, err := io.ReadFull(r, pre); err != nil {
					return nil, err
				}
				p := name + "." + ext
				if dir != " " {
					p = dir + "/" + p
				}
				v.files[strings.ToLower(p)] = vpkEntry{
					archive: meta.Archive, offset: meta.Offset, length: meta.Length, preload: pre, crc: meta.CRC,
					dirFile: dirFile, treeEnd: headerSize + int64(head.TreeSize), basePath: base,
				}
			}
		}
	}
	return v, nil
}

// List is every path under prefix with the given suffix.
func (v *VPK) List(prefix, suffix string) []string {
	var out []string
	for p := range v.files {
		if strings.HasPrefix(p, prefix) && strings.HasSuffix(p, suffix) {
			out = append(out, p)
		}
	}
	return out
}

// CRC of a file, to tell whether it changed since the last extraction.
func (v *VPK) CRC(p string) (uint32, bool) {
	e, ok := v.files[strings.ToLower(p)]
	return e.crc, ok
}

// Read a file's bytes.
func (v *VPK) Read(p string) ([]byte, error) {
	e, ok := v.files[strings.ToLower(p)]
	if !ok {
		return nil, fmt.Errorf("%s: not in the package", p)
	}
	out := append([]byte{}, e.preload...)
	if e.length == 0 {
		return out, nil
	}
	file, offset := e.dirFile, int64(e.offset)
	if e.archive == 0x7fff {
		offset += e.treeEnd
	} else {
		file = fmt.Sprintf("%s_%03d.vpk", e.basePath, e.archive)
	}
	f, err := os.Open(filepath.Clean(file))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, e.length)
	if _, err := f.ReadAt(buf, offset); err != nil {
		return nil, err
	}
	return append(out, buf...), nil
}
