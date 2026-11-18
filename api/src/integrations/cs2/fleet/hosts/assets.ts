/**
 * Map and skin pictures from a csm host's own CS2 install (host.asset): the
 * platform asks, csm reads the file from pak01 and uploads it to
 *   PUT /api/fleet/host/assets/:id   (Authorization: Bearer rhs_…, body: the picture)
 * where :id is the host.asset command. Nothing of Valve's ships with the platform or csm.
 */
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { DATA_DIR } from '../../../../config/dataDir';
import type { HostAssetSet } from '../protocol/host/v1';
import type { Untrusted } from '../../../../utils/untrusted';
import { log } from '../../../../utils/logger';
import * as registry from './registry';
import { awaitHostResult, connectedHostIds, sendHostCommand } from './service';

export interface HostAsset {
  data: Buffer;
  type: string;
}

const TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'application/json']);
export const ASSET_MAX_BYTES = 8 * 1024 * 1024;
const WAIT_MS = 25_000;
// Each picture costs the host two frames (ack, result) against its 50 msg/s limit (gateway.ts RATE).
const SPACING_MS = 70;

const uploads = new Map<string, { asset: HostAsset; at: number }>();
const waiters = new Map<string, (asset: HostAsset) => void>();
const nextSlot = new Map<string, number>();

async function assetHost(capability: string): Promise<string | null> {
  for (const id of connectedHostIds()) {
    const host = await registry.getHostView(id);
    if (host?.status === 'enrolled' && host.capabilities.includes(capability)) return id;
  }
  return null;
}

/** Waits for this host's turn, so a page of skins doesn't trip the host's rate limit. */
async function turn(hostId: string): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(hostId) ?? 0);
  nextSlot.set(hostId, at + SPACING_MS);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** One picture from a connected host; null when none has it (or none is connected). */
export async function fetchHostAsset(set: HostAssetSet, file: string): Promise<HostAsset | null> {
  const hostId = await assetHost(set === 'catalog' ? 'catalog.v1' : 'assets.v1');
  if (!hostId) return null;
  await turn(hostId);
  const { command } = await sendHostCommand(
    hostId,
    'host.asset',
    { set, file, expires_at: Date.now() + WAIT_MS },
    { issuedBy: null }
  );
  const uploaded = new Promise<HostAsset>((resolve) => {
    const early = uploads.get(command.id);
    if (early) resolve(early.asset);
    else waiters.set(command.id, resolve);
  });
  const result = await awaitHostResult(command.id, WAIT_MS);
  waiters.delete(command.id);
  if (result?.status !== 'ok') {
    uploads.delete(command.id);
    if (result && result.errorCode !== 'not_found')
      log.warn(
        `[CS2 images] ${set}/${file} from ${hostId}: ${result.errorMessage ?? result.status}`
      );
    return null;
  }
  // csm answers ok only after the PUT went through, so the upload is here.
  const asset = await Promise.race([
    uploaded,
    new Promise<null>((r) => setTimeout(() => r(null), 1000)),
  ]);
  uploads.delete(command.id);
  return asset;
}

/** PUT /api/fleet/host/assets/:id, body parsed by express.raw. */
export async function hostAssetUploadHandler(req: Request, res: Response): Promise<Response> {
  const auth = req.headers.authorization;
  const token = typeof auth === 'string' && /^bearer /i.test(auth) ? auth.slice(7).trim() : '';
  const check = await registry.verifyHostToken(token);
  if (!check.ok) return res.status(401).json({ success: false, error: 'Invalid host token' });
  const type = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim();
  // express.json() runs first for the whole app, so a JSON upload arrives parsed.
  const body =
    type === 'application/json' && req.body && !Buffer.isBuffer(req.body)
      ? Buffer.from(JSON.stringify(req.body))
      : req.body;
  if (!TYPES.has(type) || !Buffer.isBuffer(body) || body.length === 0)
    return res.status(400).json({ success: false, error: 'A PNG, JPEG, SVG or JSON body' });
  const command = await registry.getHostCommand(String(req.params.id));
  if (!command || command.type !== 'host.asset' || command.hostId !== check.host.id)
    return res.status(404).json({ success: false, error: 'No such picture request' });
  const asset = { data: body, type };
  const waiter = waiters.get(command.id);
  if (waiter) waiter(asset);
  else {
    uploads.set(command.id, { asset, at: Date.now() });
    for (const [id, u] of uploads) if (Date.now() - u.at > WAIT_MS) uploads.delete(id);
  }
  return res.status(204).end();
}

const CATALOG_DIR = path.join(DATA_DIR, 'cache', 'cs2-catalog');

/**
 * maps.json or skins.json from a connected csm host (catalog.v1), kept on disk; with no host,
 * the last copy a host sent. Null when there has never been one.
 */
export async function fetchHostCatalog(name: 'maps.json' | 'skins.json'): Promise<Untrusted> {
  const file = path.join(CATALOG_DIR, name);
  const asset = await fetchHostAsset('catalog', name).catch(() => null);
  if (asset) {
    try {
      const parsed: Untrusted = JSON.parse(asset.data.toString('utf8'));
      fs.mkdirSync(CATALOG_DIR, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, asset.data);
      fs.renameSync(`${file}.tmp`, file);
      return parsed;
    } catch (error) {
      log.warn(`[CS2 catalog] ${name} from a host: ${(error as Error).message}`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Untrusted;
  } catch {
    return null;
  }
}
