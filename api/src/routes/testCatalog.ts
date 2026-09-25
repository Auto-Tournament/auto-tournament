/**
 * Test-only fake game catalog (DESIGN-modules §10.10), the same trick the fake
 * pack index uses: the API serves the feed, the releases and their signatures
 * itself, and points the catalog at them.
 *
 *   POST /api/test/catalog { fake, run, goodVersions, feed }   switch it on or off
 *   GET  /api/test/fake-catalog/catalog.json                  the feed
 *   GET  /api/test/fake-catalog/releases/<id>-<version>.atmod[.sig]
 *   GET  /api/test/fake-catalog/packs/<slug>.json, icons/<slug>.svg
 *
 * Every release is signed here with a throwaway key made in this process and
 * trusted only in this process (`trustKeyForTests`), except `badsig`'s, which
 * is signed by a second key nobody trusts. Module ids are
 * `fixture-cat-<kind>-<run>`, so a spec's run never meets a module an earlier
 * run left loaded, and `DELETE /api/test/modules/fixtures` cleans them up.
 *
 * Kinds, each a way an install must fail or succeed:
 *
 *   good          a valid module; `goodVersions` lists the releases offered
 *   tampered      a byte of the archive flipped after it was signed
 *   badsig        signed by a key the platform does not trust
 *   traversal     a validly signed archive with a `../` entry
 *   symlink       a validly signed archive with a symlink entry
 *   wrongversion  signed as 1.0.0, but its module.json says 2.0.0
 *   incompatible  its only release needs server API ^9.0.0
 *   migfail       signed and valid, but its migration reaches into core's table
 *   offline       the download never answers; the offline snapshot has a copy
 *   redirect      the release URL redirects to a host releases never come from
 *   hop           the release URL redirects once, to an allowed asset origin (this API's)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { DATA_DIR } from '../config/dataDir';
import { writeModuleArchive } from '../modules/archive';
import { setCatalogOverridesForTests } from '../modules/catalogFeed';
import { signModuleArchive } from '../modules/signature';
import { trustKeyForTests } from '../modules/trustedKeys';
import {
  MODULE_MAX_VERSION_KEY_PREFIX,
  purgeableTables,
  purgeModuleData,
  restoreInterruptedSwaps,
  autoUpdateModulesFromSnapshot,
  MODULE_INSTALL_KEY_PREFIX,
} from '../modules/catalogService';
import { forgetDiskModule, loadModuleNow, modulesDir, storeEnabled } from '../modules/loader';
import { isValidModuleId } from '../modules/manifest';
import { db } from '../config/database';

type FixtureFiles = (id: string, kind: 'valid' | 'bad-migration') => Record<string, string>;

const KINDS = [
  'good',
  'tampered',
  'badsig',
  'traversal',
  'symlink',
  'wrongversion',
  'incompatible',
  'migfail',
  'offline',
  'redirect',
  'hop',
  'autoup',
  'autooff',
  'automanual',
  'autobadsig',
  'automajor',
] as const;
type Kind = (typeof KINDS)[number];

interface FakeState {
  run: string;
  goodVersions: string[];
  /** `ok`, `hang` (answers after the feed timeout) or `down` (503). */
  feed: 'ok' | 'hang' | 'down';
}

let state: FakeState | null = null;
let trusted: crypto.KeyObject | null = null;
let untrusted: crypto.KeyObject | null = null;
const built = new Map<string, { archive: Buffer; signature: string }>();

const SNAPSHOT_DIR = () => path.join(DATA_DIR, 'test-catalog-snapshot');
const CACHE_FILE = () => path.join(DATA_DIR, 'test-catalog-cache.json');

function idFor(kind: Kind, run: string): string {
  return `fixture-cat-${kind}-${run}`;
}

function kindOf(id: string, run: string): Kind | null {
  for (const kind of KINDS) if (idFor(kind, run) === id) return kind;
  return null;
}

/** A tar header for the raw archives the platform's own writer refuses to make. */
function rawHeader(name: string, size: number, type: string, linkname = ''): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  block.write('00000000000\0', 136, 'ascii');
  block.fill(0x20, 148, 156);
  block.write(type, 156, 'ascii');
  block.write(linkname, 157, 100, 'utf8');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

function rawArchive(files: Record<string, string>, extra: Array<{ name: string; type: string; data?: string; linkname?: string }>): Buffer {
  const parts: Buffer[] = [];
  const add = (name: string, type: string, data: Buffer, linkname?: string) => {
    parts.push(rawHeader(name, data.length, type, linkname));
    parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  };
  for (const [name, text] of Object.entries(files)) add(name, '0', Buffer.from(text, 'utf8'));
  for (const entry of extra) add(entry.name, entry.type, Buffer.from(entry.data ?? '', 'utf8'), entry.linkname);
  parts.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(parts));
}

function withVersion(files: Record<string, string>, version: string): Record<string, string> {
  const manifest = JSON.parse(files['module.json']) as Record<string, unknown>;
  return { ...files, 'module.json': JSON.stringify({ ...manifest, version }, null, 2) };
}

function toEntries(files: Record<string, string>) {
  return Object.entries(files).map(([file, text]) => ({ path: file, data: Buffer.from(text, 'utf8') }));
}

function release(kind: Kind, id: string, version: string, fixtureFiles: FixtureFiles): { archive: Buffer; signature: string } {
  const key = `${id}@${version}`;
  const cached = built.get(key);
  if (cached) return cached;

  const valid = withVersion(fixtureFiles(id, kind === 'migfail' ? 'bad-migration' : 'valid'), version);
  let archive: Buffer;
  let signer = trusted!;
  switch (kind) {
    case 'traversal':
      archive = rawArchive(valid, [{ name: '../escape.txt', type: '0', data: 'escaped' }]);
      break;
    case 'symlink':
      archive = rawArchive(valid, [{ name: 'server/passwd', type: '2', linkname: '/etc/passwd' }]);
      break;
    case 'wrongversion':
      archive = writeModuleArchive(toEntries(withVersion(valid, '2.0.0')));
      break;
    case 'badsig':
    case 'autobadsig':
      archive = writeModuleArchive(toEntries(valid));
      signer = untrusted!;
      break;
    default:
      archive = writeModuleArchive(toEntries(valid));
  }
  // `wrongversion` is signed as `version` although its module.json says 2.0.0.
  const signature = JSON.stringify(signModuleArchive(archive, { id, version }, signer), null, 2);
  if (kind === 'tampered') {
    archive = Buffer.from(archive);
    archive[archive.length - 10] ^= 0xff;
  }
  const result = { archive, signature };
  built.set(key, result);
  return result;
}

function self(): string {
  return `http://127.0.0.1:${process.env.PORT || '3000'}/api/test/fake-catalog/`;
}

function feed(run: string, goodVersions: string[]) {
  const url = (id: string, version: string) => `${self()}releases/${id}-${version}.atmod`;
  const entry = (kind: Kind, versions: string[], serverApi = '^0.1.0') => {
    const id = idFor(kind, run);
    return {
      id,
      name: `Catalog fixture ${kind}`,
      description: `A fixture module: ${kind}.`,
      releases: versions.map((version) => ({ version, serverApi, clientApi: '^0.2.0', url: url(id, version) })),
    };
  };
  return {
    schema: 1,
    packs: [
      {
        slug: 'index-test-game',
        name: 'Index Test Game',
        version: '2.0.0',
        engine: 'manual-report',
        description: 'A game that exists only in the fake catalog.',
        file: 'packs/index-test-game.json',
        icon: 'icons/index-test-game.svg',
      },
    ],
    modules: [
      entry('good', goodVersions),
      entry('tampered', ['1.0.0']),
      entry('badsig', ['1.0.0']),
      entry('traversal', ['1.0.0']),
      entry('symlink', ['1.0.0']),
      entry('wrongversion', ['1.0.0']),
      entry('incompatible', ['1.0.0'], '^9.0.0'),
      entry('migfail', ['1.0.0']),
      entry('offline', ['1.0.0']),
      entry('redirect', ['1.0.0']),
      entry('hop', ['1.1.0']),
      // Refused by the feed parser: a release URL outside the allowed prefix.
      {
        id: `fixture-cat-elsewhere-${run}`,
        name: 'Elsewhere',
        releases: [{ version: '1.0.0', serverApi: '^0.1.0', clientApi: '^0.2.0', url: 'https://example.com/evil.atmod' }],
      },
    ],
  };
}

/**
 * The offline snapshot, signed, with its index: `offline`'s release, and the
 * newer releases boot's automatic update finds for the `auto*` modules (a
 * spec seeds their 1.0.0 as installed): 1.1.0, signed by an untrusted key for
 * `autobadsig`, and only a new major, 2.0.0, for `automajor`.
 */
async function writeSnapshot(run: string, fixtureFiles: FixtureFiles): Promise<void> {
  const dir = SNAPSHOT_DIR();
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  const offered: Array<[Kind, string]> = [
    ['offline', '1.0.0'],
    ['autoup', '1.1.0'],
    ['autooff', '1.1.0'],
    ['automanual', '1.1.0'],
    ['autobadsig', '1.1.0'],
    ['automajor', '2.0.0'],
  ];
  const modules = [];
  for (const [kind, version] of offered) {
    const id = idFor(kind, run);
    const { archive, signature } = release(kind, id, version, fixtureFiles);
    const file = `${id}-${version}.atmod`;
    await fs.promises.writeFile(path.join(dir, file), archive);
    await fs.promises.writeFile(path.join(dir, `${file}.sig`), signature);
    modules.push({
      id,
      name: `Catalog fixture ${kind}`,
      description: `A fixture module: ${kind}.`,
      releases: [{ version, serverApi: '^0.1.0', clientApi: '^0.2.0', file }],
    });
  }
  await fs.promises.writeFile(path.join(dir, 'index.json'), JSON.stringify({ schema: 1, modules }));
}

/**
 * Test-only: a module's purge, run inside a transaction that is rolled back —
 * what `POST /api/catalog/modules/<id>/purge` would drop and whether it
 * would succeed, for a module the running suite cannot unload (CS2).
 */
async function purgeProbe(id: string): Promise<{ ok: boolean; tables: string[]; constraints: string[]; error?: string }> {
  const tables = await purgeableTables(id);
  return db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const report = await purgeModuleData(client, id, tables);
      const left = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)",
        [tables]
      );
      if (left.rows.length > 0) throw new Error(`still there: ${left.rows.map((r) => r.tablename).join(', ')}`);
      return { ok: true, ...report };
    } catch (error) {
      return { ok: false, tables, constraints: [], error: (error as Error).message };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
  });
}

export function registerCatalogTestRoutes(
  router: Router,
  helpersEnabled: (res: Response) => boolean,
  fixtureFiles: FixtureFiles,
  fakePack: { pack: (slug: string) => unknown; tile: string }
): void {
  router.post('/catalog', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    const body = (req.body ?? {}) as { fake?: unknown; run?: unknown; goodVersions?: unknown; feed?: unknown; resetCache?: unknown };
    if (body.fake === false) {
      state = null;
      setCatalogOverridesForTests(null);
      res.json({ success: true, fake: false });
      return;
    }
    const run = typeof body.run === 'string' && /^[a-z0-9]{1,20}$/.test(body.run) ? body.run : null;
    if (!run) {
      res.status(400).json({ success: false, error: 'run must be 1-20 lowercase letters or digits' });
      return;
    }
    const goodVersions = Array.isArray(body.goodVersions)
      ? body.goodVersions.filter((v): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v))
      : ['1.0.0'];
    const feedMode = body.feed === 'hang' || body.feed === 'down' ? body.feed : 'ok';

    trusted ??= crypto.generateKeyPairSync('ed25519').privateKey;
    untrusted ??= crypto.generateKeyPairSync('ed25519').privateKey;
    const raw = crypto.createPublicKey(trusted).export({ format: 'jwk' }).x as string;
    trustKeyForTests(Buffer.from(raw, 'base64url').toString('base64'));

    state = { run, goodVersions, feed: feedMode };
    setCatalogOverridesForTests({
      catalogUrl: `${self()}catalog.json`,
      releasePrefix: self(),
      // The one origin a release may redirect to here, in place of GitHub's asset hosts.
      redirectOrigins: [new URL(self()).origin],
      feedTimeoutMs: 1500,
      downloadTimeoutMs: 1500,
      snapshotDir: SNAPSHOT_DIR(),
      cacheFile: CACHE_FILE(),
    });
    if (body.resetCache === true) await fs.promises.rm(CACHE_FILE(), { force: true });
    await writeSnapshot(run, fixtureFiles);
    res.json({
      success: true,
      ids: Object.fromEntries(KINDS.map((kind) => [kind, idFor(kind, run)])),
    });
  });

  router.post('/modules/:id/purge-probe', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    if (!isValidModuleId(req.params.id)) {
      res.status(400).json({ success: false, error: 'Not a valid module id' });
      return;
    }
    res.json({ success: true, ...(await purgeProbe(req.params.id)) });
  });

  // A migration the fixture module does not declare, as a newer version would
  // have left in the ledger. Fixture ids only.
  router.post('/modules/:id/ledger', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    const migrationId = (req.body as { migrationId?: unknown } | undefined)?.migrationId;
    if (!isValidModuleId(req.params.id) || !req.params.id.startsWith('fixture-') || typeof migrationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(migrationId)) {
      res.status(400).json({ success: false, error: 'A fixture module id and a migration id are required' });
      return;
    }
    await db.runAsync(
      'INSERT INTO module_migrations (module_id, migration_id, checksum) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      [req.params.id, migrationId, 'f'.repeat(64)]
    );
    res.json({ success: true });
  });

  const fixtureId = (res: Response, id: string): boolean => {
    if (isValidModuleId(id) && id.startsWith('fixture-')) return true;
    res.status(400).json({ success: false, error: "id must be a valid module id starting with 'fixture-'" });
    return false;
  };

  // The highest version the instance recorded for a fixture module, and a way
  // to set it (as if a newer one had been installed and removed).
  router.get('/modules/:id/max-version', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res) || !fixtureId(res, req.params.id)) return;
    res.json({ success: true, version: await db.getAppSettingAsync(`${MODULE_MAX_VERSION_KEY_PREFIX}${req.params.id}`) });
  });
  router.post('/modules/:id/max-version', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res) || !fixtureId(res, req.params.id)) return;
    const version = (req.body as { version?: unknown } | undefined)?.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      res.status(400).json({ success: false, error: 'version must be x.y.z' });
      return;
    }
    await db.setAppSettingAsync(`${MODULE_MAX_VERSION_KEY_PREFIX}${req.params.id}`, version);
    res.json({ success: true });
  });

  // What a crash between an install's two renames leaves: the module's folder
  // in .previous and nothing in its place. Then what boot does about it.
  router.post('/modules/:id/interrupt-swap', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res) || !fixtureId(res, req.params.id)) return;
    const live = path.join(modulesDir(), req.params.id);
    const previous = path.join(modulesDir(), '.previous', req.params.id);
    await fs.promises.mkdir(path.dirname(previous), { recursive: true });
    await fs.promises.rm(previous, { recursive: true, force: true });
    await fs.promises.rename(live, previous);
    forgetDiskModule(req.params.id);
    res.json({ success: true });
  });
  router.post('/modules/restore-swaps', requireAuth, async (_req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    await restoreInterruptedSwaps();
    res.json({ success: true });
  });

  // What an older image left on disk, not loaded: a fixture module's 1.0.0 in
  // its folder with its switch, installed from the snapshot (or, `manual`, a
  // folder an operator dropped in, with no install record).
  router.post('/modules/:id/seed-installed', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res) || !fixtureId(res, req.params.id)) return;
    const { enabled, manual } = (req.body ?? {}) as { enabled?: unknown; manual?: unknown };
    const id = req.params.id;
    const dir = path.join(modulesDir(), id);
    await fs.promises.rm(dir, { recursive: true, force: true });
    for (const [file, text] of Object.entries(withVersion(fixtureFiles(id, 'valid'), '1.0.0'))) {
      await fs.promises.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.promises.writeFile(path.join(dir, file), text);
    }
    await db.setAppSettingAsync(
      `${MODULE_INSTALL_KEY_PREFIX}${id}`,
      manual === true
        ? null
        : JSON.stringify({ source: 'snapshot', version: '1.0.0', sha256: '0'.repeat(64), keyId: '0'.repeat(16), installedAt: 0, installedBy: null })
    );
    await storeEnabled(id, enabled !== false);
    forgetDiskModule(id);
    res.json({ success: true });
  });

  // Boot's automatic update for these fixture modules, then what the boot
  // scan does next: load the enabled ones.
  router.post('/modules/auto-update', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    const ids = (req.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isValidModuleId(id) || !id.startsWith('fixture-'))) {
      res.status(400).json({ success: false, error: "ids must be module ids starting with 'fixture-'" });
      return;
    }
    const outcomes = await autoUpdateModulesFromSnapshot(ids as string[]);
    const states: Record<string, unknown> = {};
    for (const id of ids as string[]) states[id] = await loadModuleNow(id);
    res.json({ success: true, outcomes, states });
  });

  router.get('/fake-catalog/catalog.json', async (_req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    if (!state) {
      res.status(404).json({ success: false, error: 'The fake catalog is off' });
      return;
    }
    if (state.feed === 'down') {
      res.status(503).json({ success: false, error: 'down' });
      return;
    }
    if (state.feed === 'hang') await new Promise((resolve) => setTimeout(resolve, 4000));
    res.json(feed(state.run, state.goodVersions));
  });

  router.get('/fake-catalog/releases/:file', async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    const match = /^(fixture-cat-[a-z]+-[a-z0-9]+)-(\d+\.\d+\.\d+)\.atmod(\.sig)?$/.exec(req.params.file);
    const kind = match && state ? kindOf(match[1], state.run) : null;
    if (!match || !kind || !state) {
      res.status(404).json({ success: false, error: 'No such release' });
      return;
    }
    if (kind === 'offline') {
      // Never answers in time: the install must fall back to the snapshot.
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    if (kind === 'redirect') {
      res.redirect(302, `https://example.com/${req.params.file}`);
      return;
    }
    if (kind === 'hop' && req.query.cdn !== '1') {
      res.redirect(302, `${self()}releases/${req.params.file}?cdn=1`);
      return;
    }
    const { archive, signature } = release(kind, match[1], match[2], fixtureFiles);
    if (match[3]) {
      res.type('application/json').send(signature);
    } else {
      res.type('application/octet-stream').send(archive);
    }
  });

  router.get('/fake-catalog/packs/:file', (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    const pack = fakePack.pack(req.params.file.replace(/\.json$/, ''));
    if (!pack) {
      res.status(404).json({ success: false, error: 'No such pack' });
      return;
    }
    res.json(pack);
  });

  router.get('/fake-catalog/icons/:file', (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    if (req.params.file !== 'index-test-game.svg') {
      res.status(404).json({ success: false, error: 'No such icon' });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.send(fakePack.tile);
  });
}
