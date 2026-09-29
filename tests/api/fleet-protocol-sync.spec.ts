import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

/**
 * The fleet protocol schemas are copied between Ready Up
 * (`plugins/fleet/protocol/v1`) and the platform
 * (`api/src/integrations/cs2/fleet/protocol/v1`), FLEET.md D18. A copy that
 * drifts is how `server.cs2_update_required` came to fail the platform's
 * envelope pattern and loop Ready Up's spool.
 *
 * Every schema file that exists on both sides must be the same JSON. Files
 * only Ready Up has are listed (proposed, not adopted yet) but do not fail.
 *
 * Ready Up's side comes from `READYUP_DIR` (a local checkout) when set, else
 * from GitHub (`READYUP_REF`, default `master`). Without network the test is
 * skipped.
 *
 * @tag api
 */

const PLATFORM_DIR = path.resolve(__dirname, '../../api/src/integrations/cs2/fleet/protocol/v1');
const READYUP_PROTOCOL = 'plugins/fleet/protocol/v1';
const REPO = 'Auto-Tournament/ready-up';

function platformFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) out.push(path.relative(PLATFORM_DIR, full).split(path.sep).join('/'));
    }
  };
  walk(PLATFORM_DIR);
  return out.sort();
}

/** Ready Up's schema files (relative to protocol/v1) and a reader for them; null when unreachable. */
async function readyUpSource(): Promise<{ files: string[]; read(rel: string): Promise<string> } | null> {
  const local = process.env.READYUP_DIR;
  if (local) {
    const root = path.resolve(local, READYUP_PROTOCOL);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json')) files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    };
    walk(root);
    return { files: files.sort(), read: async (rel) => fs.readFileSync(path.join(root, rel), 'utf8') };
  }

  const ref = process.env.READYUP_REF || 'master';
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'auto-tournament-tests' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await globalThis.fetch(`https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
      headers,
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const tree = (await res.json()) as { tree: { path: string; type: string }[] };
    const prefix = `${READYUP_PROTOCOL}/`;
    const files = tree.tree
      .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.json'))
      .map((e) => e.path.slice(prefix.length))
      .sort();
    return {
      files,
      read: async (rel) => {
        const r = await globalThis.fetch(`https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(ref)}/${prefix}${rel}`, {
          signal: globalThis.AbortSignal.timeout(15_000),
        });
        if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
        return r.text();
      },
    };
  } catch {
    return null;
  }
}

test.describe('Fleet protocol: in sync with Ready Up', () => {
  test('every schema both sides have is the same JSON', async () => {
    test.setTimeout(120_000);
    const source = await readyUpSource();
    test.skip(source === null, 'Ready Up protocol not reachable (set READYUP_DIR to a local checkout)');
    if (!source) return;

    const ours = new Set(platformFiles());
    const shared = source.files.filter((f) => ours.has(f));
    expect(shared.length, 'no schema files in common: wrong path?').toBeGreaterThanOrEqual(40);

    const drift: string[] = [];
    for (const rel of shared) {
      const theirs = JSON.parse(await source.read(rel)) as unknown;
      const mine = JSON.parse(fs.readFileSync(path.join(PLATFORM_DIR, rel), 'utf8')) as unknown;
      try {
        expect(mine).toEqual(theirs);
      } catch {
        drift.push(rel);
      }
    }
    const onlyReadyUp = source.files.filter((f) => !ours.has(f));
    if (onlyReadyUp.length) {
      test.info().annotations.push({ type: 'ready-up only (not adopted)', description: onlyReadyUp.join(', ') });
    }
    expect(drift, `copy these from ${REPO} ${READYUP_PROTOCOL} (or change both sides)`).toEqual([]);
  });
});
