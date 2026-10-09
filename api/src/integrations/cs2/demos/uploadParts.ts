/**
 * Uploads in parts. Cloudflare turns down a request body over 100 MB, and a
 * 1440p120 clip or a long reel is bigger than that. The recorder sends such a
 * file in parts (POST /recorder/uploads for an id, then PUT
 * /recorder/uploads/:id?offset=N for each part) and then makes the usual PUT
 * with `X-AT-Upload: <id>` and no body. The route reads the staged file in
 * place of the request (bodyOf), and the staged file is removed once read.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { HIGHLIGHTS_DIR } from './highlights';

const DIR = path.join(HIGHLIGHTS_DIR, 'uploads');
const ID = /^[0-9a-f]{32}$/;
/** One part's most: under Cloudflare's 100 MB. */
export const MAX_PART = 96 * 1024 * 1024;
/** One file's most. */
const MAX_FILE = 8 * 1024 * 1024 * 1024;
/** An upload no one finished is removed after this long. */
const STALE_MS = 6 * 60 * 60 * 1000;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bytes?: number
  ) {
    super(message);
  }
}

const fileOf = (id: string) => path.join(DIR, `${id}.part`);

async function prune(): Promise<void> {
  const now = Date.now();
  for (const name of await fs.promises.readdir(DIR).catch(() => [] as string[])) {
    const file = path.join(DIR, name);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (stat && now - stat.mtimeMs > STALE_MS) await fs.promises.rm(file, { force: true });
  }
}

/** A new, empty upload: its id. */
export async function startUpload(): Promise<string> {
  await fs.promises.mkdir(DIR, { recursive: true });
  await prune();
  const id = crypto.randomBytes(16).toString('hex');
  await fs.promises.writeFile(fileOf(id), '');
  return id;
}

/**
 * Add a part at `offset`, which must be where the upload ends now (a part
 * sent again after a lost answer is turned down with the size, 409). The
 * upload's size after it.
 */
export async function appendPart(
  id: string,
  offset: number,
  body: NodeJS.ReadableStream
): Promise<number> {
  if (!ID.test(id)) throw new UploadError('Which upload', 400);
  const file = fileOf(id);
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat) throw new UploadError('No such upload', 404);
  if (offset !== stat.size) throw new UploadError('The upload is elsewhere', 409, stat.size);
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file, { flags: 'a' });
    body.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_PART || stat.size + bytes > MAX_FILE) {
        out.destroy();
        reject(new UploadError('Too big', 413));
      }
    });
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  return stat.size + bytes;
}

/**
 * What a recorder route reads its file from: the staged upload the request
 * names with X-AT-Upload, or the request itself.
 */
export function bodyOf(req: Request): NodeJS.ReadableStream {
  const id = req.headers['x-at-upload'];
  if (id === undefined) return req;
  if (typeof id !== 'string' || !ID.test(id)) throw new UploadError('Which upload', 400);
  const file = fileOf(id);
  if (!fs.existsSync(file)) throw new UploadError('No such upload', 404);
  req.resume();
  const stream = fs.createReadStream(file);
  stream.on('close', () => void fs.promises.rm(file, { force: true }));
  return stream;
}
