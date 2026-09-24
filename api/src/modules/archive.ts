/**
 * The module release archive, `<id>-<version>.atmod`: a gzip'd ustar archive
 * rooted at the module folder (DESIGN-modules §10.3).
 *
 * Both halves are ours, with no dependency:
 *
 * - `writeModuleArchive` makes the archive the release tooling signs. It
 *   writes regular files only, sorted, with mtime 0, uid/gid 0 and mode 0644,
 *   so building the same tree twice gives the same bytes.
 * - `readModuleArchive` reads one back, and it is strict on purpose: it
 *   accepts what the writer produces and refuses everything else. No
 *   symlinks, hardlinks, devices, FIFOs, pax or GNU long-name headers, no
 *   absolute paths, no `..`, no names outside the entry alphabet, no
 *   duplicates (case-insensitively, for case-folding filesystems), and every
 *   size capped.
 *
 * The reader runs only on bytes whose signature has already been verified
 * (`installer.ts`), so everything here is a second line. It is still written
 * as if it were the first.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export interface ArchiveEntry {
  /** `/`-separated path inside the module folder. */
  path: string;
  data: Buffer;
}

export interface ArchiveLimits {
  /** Largest unpacked size of all entries together. */
  maxUnpackedBytes: number;
  /** Largest single file. */
  maxFileBytes: number;
  maxEntries: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxUnpackedBytes: 256 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxEntries: 5000,
};

const BLOCK = 512;
const MAX_PATH_LENGTH = 255;
const MAX_DEPTH = 16;
/** One path segment: the same alphabet `manifest.isSafeEntryPath` allows. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export class ArchiveError extends Error {}

/** Why `entryPath` may not be a name in an archive, or null when it may. */
export function entryPathProblem(entryPath: string): string | null {
  if (entryPath.length === 0) return 'an entry has an empty name';
  if (entryPath.length > MAX_PATH_LENGTH) return `an entry name is longer than ${MAX_PATH_LENGTH} characters`;
  if (entryPath.includes('\0') || entryPath.includes('\\')) return `'${printable(entryPath)}' has a forbidden character`;
  if (entryPath.startsWith('/')) return `'${printable(entryPath)}' is an absolute path`;
  const segments = entryPath.split('/');
  if (segments.length > MAX_DEPTH) return `'${printable(entryPath)}' is nested too deeply`;
  for (const segment of segments) {
    if (segment === '..') return `'${printable(entryPath)}' climbs out of the module folder`;
    if (segment === '' || segment === '.' || /^\.+$/.test(segment) || !SEGMENT.test(segment)) {
      return `'${printable(entryPath)}' is not a plain relative path`;
    }
  }
  return null;
}

function printable(value: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '?');
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function writeString(block: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new ArchiveError(`'${value}' does not fit a tar header field`);
  bytes.copy(block, offset);
}

function writeOctal(block: Buffer, offset: number, length: number, value: number): void {
  // length - 1 digits, then NUL.
  const digits = value.toString(8).padStart(length - 1, '0');
  if (digits.length > length - 1) throw new ArchiveError('a value does not fit a tar header field');
  writeString(block, offset, length, `${digits}\0`);
}

/** Split a path into ustar's `prefix` (155) and `name` (100) at a `/`. */
function splitName(entryPath: string): { prefix: string; name: string } {
  if (Buffer.byteLength(entryPath) <= 100) return { prefix: '', name: entryPath };
  for (let i = entryPath.lastIndexOf('/'); i > 0; i = entryPath.lastIndexOf('/', i - 1)) {
    const prefix = entryPath.slice(0, i);
    const name = entryPath.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { prefix, name };
  }
  throw new ArchiveError(`'${entryPath}' is too long for a tar header`);
}

function header(entryPath: string, size: number): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  const { prefix, name } = splitName(entryPath);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  block.fill(0x20, 148, 156); // checksum placeholder: eight spaces
  block[156] = 0x30; // '0': a regular file
  writeString(block, 257, 6, 'ustar\0');
  writeString(block, 263, 2, '00');
  writeString(block, 345, 155, prefix);
  let sum = 0;
  for (const byte of block) sum += byte;
  writeString(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

/**
 * The archive for `entries`: gzip'd ustar, files sorted by path, every header
 * field fixed except name and size. Throws on a name the reader would refuse,
 * so a release can never contain one.
 */
export function writeModuleArchive(entries: ArchiveEntry[]): Buffer {
  const seen = new Set<string>();
  const parts: Buffer[] = [];
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const problem = entryPathProblem(entry.path);
    if (problem) throw new ArchiveError(problem);
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new ArchiveError(`'${entry.path}' is in the archive twice`);
    seen.add(key);
    parts.push(header(entry.path, entry.data.length), entry.data);
    const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  // mtime 0 and no file name in the gzip header: the same tree gives the same bytes.
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

/** Every file under `dir`, as archive entries with `/` paths. Refuses symlinks. */
export async function collectDirectory(dir: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  async function walk(current: string, relative: string): Promise<void> {
    for (const dirent of await fs.promises.readdir(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${dirent.name}` : dirent.name;
      const full = path.join(current, dirent.name);
      if (dirent.isSymbolicLink()) throw new ArchiveError(`'${rel}' is a symlink; a module archive holds none`);
      if (dirent.isDirectory()) await walk(full, rel);
      else if (dirent.isFile()) entries.push({ path: rel, data: await fs.promises.readFile(full) });
      else throw new ArchiveError(`'${rel}' is not a regular file`);
    }
  }
  await walk(dir, '');
  return entries;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readString(block: Buffer, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? length : end).toString('utf8');
}

function readOctal(block: Buffer, offset: number, length: number, what: string): number {
  const field = block.subarray(offset, offset + length);
  // Base-256 (the high bit set) is GNU's large-file form; we never write it.
  if (field[0] & 0x80) throw new ArchiveError(`the ${what} field uses an encoding this reader refuses`);
  const text = readString(block, offset, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError(`the ${what} field is not octal`);
  return parseInt(text, 8);
}

function checksumOk(block: Buffer): boolean {
  const stored = readOctal(block, 148, 8, 'checksum');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return sum === stored;
}

/**
 * The files in a gzip'd module archive, checked. Throws `ArchiveError` with a
 * sentence on anything it refuses.
 */
export function readModuleArchive(
  gzipped: Buffer,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
): ArchiveEntry[] {
  let tar: Buffer;
  try {
    // Headers and padding on top of the files; the cap still stops a bomb.
    tar = zlib.gunzipSync(gzipped, {
      maxOutputLength: limits.maxUnpackedBytes + (limits.maxEntries + 2) * BLOCK * 2,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new ArchiveError('the archive unpacks to more than the size limit');
    throw new ArchiveError(`the archive is not valid gzip: ${(error as Error).message}`);
  }

  const entries: ArchiveEntry[] = [];
  const names = new Set<string>();
  const directories = new Set<string>();
  let total = 0;
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) return finish(entries, names, directories);

    if (!checksumOk(block)) throw new ArchiveError('an entry header has a bad checksum');
    const magic = readString(block, 257, 6);
    if (magic !== 'ustar') throw new ArchiveError('the archive is not ustar');

    const typeflag = String.fromCharCode(block[156]);
    const name = readString(block, 0, 100);
    const prefix = readString(block, 345, 155);
    let entryPath = prefix ? `${prefix}/${name}` : name;
    const size = readOctal(block, 124, 12, 'size');
    offset += BLOCK;

    if (typeflag === '5') {
      entryPath = entryPath.replace(/\/$/, '');
      const problem = entryPathProblem(entryPath);
      if (problem) throw new ArchiveError(problem);
      if (size !== 0) throw new ArchiveError(`the directory '${printable(entryPath)}' has a size`);
      directories.add(entryPath.toLowerCase());
    } else if (typeflag === '0' || typeflag === '\0') {
      const problem = entryPathProblem(entryPath);
      if (problem) throw new ArchiveError(problem);
      const key = entryPath.toLowerCase();
      if (names.has(key)) throw new ArchiveError(`'${printable(entryPath)}' is in the archive twice`);
      if (size > limits.maxFileBytes) throw new ArchiveError(`'${printable(entryPath)}' is larger than the file size limit`);
      total += size;
      if (total > limits.maxUnpackedBytes) throw new ArchiveError('the archive unpacks to more than the size limit');
      if (offset + size > tar.length) throw new ArchiveError('the archive is truncated');
      names.add(key);
      entries.push({ path: entryPath, data: Buffer.from(tar.subarray(offset, offset + size)) });
      offset += Math.ceil(size / BLOCK) * BLOCK;
    } else {
      const kind: Record<string, string> = {
        '1': 'a hard link',
        '2': 'a symlink',
        '3': 'a character device',
        '4': 'a block device',
        '6': 'a FIFO',
        x: 'a pax header',
        g: 'a pax header',
        L: 'a GNU long name',
        K: 'a GNU long link',
      };
      throw new ArchiveError(
        `'${printable(entryPath)}' is ${kind[typeflag] ?? `of type '${printable(typeflag)}'`}; a module archive holds regular files only`
      );
    }

    if (entries.length + directories.size > limits.maxEntries) {
      throw new ArchiveError(`the archive has more than ${limits.maxEntries} entries`);
    }
  }
  // No end-of-archive marker: the archive was cut short.
  throw new ArchiveError('the archive is truncated');
}

function finish(entries: ArchiveEntry[], names: Set<string>, directories: Set<string>): ArchiveEntry[] {
  // A path that is a file and also a parent of another path is ambiguous on disk.
  for (const entry of entries) {
    const segments = entry.path.toLowerCase().split('/');
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join('/');
      if (names.has(parent)) {
        throw new ArchiveError(`'${printable(parent)}' is both a file and a folder`);
      }
    }
  }
  for (const dir of directories) {
    if (names.has(dir)) throw new ArchiveError(`'${printable(dir)}' is both a file and a folder`);
  }
  return entries;
}

/**
 * Write checked entries under `root`, which must not exist yet. Every file is
 * created fresh (`wx`) with mode 0644 and every folder 0755, and each target
 * is resolved and checked to lie inside `root`. No symlink is ever created,
 * so no write can follow one.
 */
export async function extractEntries(entries: ArchiveEntry[], root: string): Promise<void> {
  await fs.promises.mkdir(root, { recursive: false, mode: 0o755 });
  const realRoot = await fs.promises.realpath(root);
  for (const entry of entries) {
    const problem = entryPathProblem(entry.path);
    if (problem) throw new ArchiveError(problem);
    const target = path.resolve(realRoot, ...entry.path.split('/'));
    const rel = path.relative(realRoot, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ArchiveError(`'${printable(entry.path)}' resolves outside the module folder`);
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await fs.promises.writeFile(target, entry.data, { flag: 'wx', mode: 0o644 });
  }
}
