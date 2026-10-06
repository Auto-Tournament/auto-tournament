/**
 * A minimal streaming tar (ustar) writer, for downloading many demos at once
 * (GET /api/demos/archive.tar). No compression (demos barely shrink) and no
 * dependency: a 512-byte header per file, the file, padding to 512, and two
 * empty blocks at the end. Files up to 8 GB each (11 octal digits of size).
 */
import fs from 'fs';
import type { Writable } from 'stream';

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

/** The header for one file. Names longer than 100 bytes use the ustar prefix field. */
export function tarHeader(name: string, size: number, mtime: number): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  let file = name;
  let prefix = '';
  if (Buffer.byteLength(file) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut > 0) {
      prefix = name.slice(0, cut);
      file = name.slice(cut + 1);
    }
    file = file.slice(-100);
  }
  header.write(file, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(size, 12), 124, 12, 'ascii');
  header.write(octal(Math.floor(mtime), 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix.slice(0, 155), 345, 155, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 7) + ' ', 148, 8, 'ascii');
  return header;
}

function write(out: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (out.write(chunk)) resolve();
    else {
      out.once('drain', resolve);
      out.once('error', reject);
    }
  });
}

/** Stream `files` (name in the archive, path on disk) into `out` as one tar. Missing files are skipped. */
export async function writeTar(out: Writable, files: Array<{ name: string; path: string }>): Promise<number> {
  let written = 0;
  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file.path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    await write(out, tarHeader(file.name, stat.size, stat.mtimeMs / 1000));
    await new Promise<void>((resolve, reject) => {
      const input = fs.createReadStream(file.path);
      input.on('error', reject);
      input.on('end', resolve);
      input.pipe(out, { end: false });
    });
    const pad = (BLOCK - (stat.size % BLOCK)) % BLOCK;
    if (pad) await write(out, Buffer.alloc(pad, 0));
    written++;
  }
  await write(out, Buffer.alloc(BLOCK * 2, 0));
  return written;
}
