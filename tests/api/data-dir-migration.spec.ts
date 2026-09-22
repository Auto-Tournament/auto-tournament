import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from '@playwright/test';
import { mergeLegacyDataDir } from '../../api/src/config/migrateLegacyDataDir';

/**
 * `DATA_DIR`'s legacy-directory migration.
 *
 * Regression test for the bug fixed alongside this file: in the bundled
 * build (and therefore Docker), `config/dataDir.ts` resolved `DATA_DIR` one
 * directory above where `docker/docker-compose.yml` mounts the persistent
 * volume (`/data` instead of `/app/data`), so demos and event logs written
 * there lived only in the container's writable layer and were lost on every
 * container recreate. See `config/dataDir.ts` and
 * `config/migrateLegacyDataDir.ts`.
 *
 * `DATA_DIR`/`LEGACY_DATA_DIR` themselves are computed once from this
 * module's real `__dirname`, so they aren't practical to parametrize here.
 * This instead exercises `mergeLegacyDataDir`, the recursive move/merge the
 * real migration is built on, against throwaway directories -- covering the
 * shapes the live bug actually left behind (nested `demos/<slug>/*.dem` and
 * `logs/events/*.log`) plus the safety properties the fix depends on: never
 * overwrite, and idempotent on repeated runs.
 *
 * @tag api
 * @tag regression
 */

function mkTmpPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-data-dir-migration-'));
  const from = path.join(root, 'legacy');
  const to = path.join(root, 'data');
  fs.mkdirSync(from, { recursive: true });
  fs.mkdirSync(to, { recursive: true });
  return { root, from, to };
}

test.describe('mergeLegacyDataDir', () => {
  test('moves nested demos/ and logs/ trees into the new directory', () => {
    const { from, to } = mkTmpPair();

    fs.mkdirSync(path.join(from, 'demos', 'r1m1'), { recursive: true });
    fs.writeFileSync(path.join(from, 'demos', 'r1m1', 'match.dem'), 'demo-bytes');
    fs.mkdirSync(path.join(from, 'logs', 'events'), { recursive: true });
    fs.writeFileSync(path.join(from, 'logs', 'events', 'events-2026-01-01.log'), '{}\n');

    const stats = mergeLegacyDataDir(from, to);

    expect(stats).toEqual({ moved: 2, skipped: 0 });
    expect(fs.readFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'utf8')).toBe('demo-bytes');
    expect(fs.readFileSync(path.join(to, 'logs', 'events', 'events-2026-01-01.log'), 'utf8')).toBe(
      '{}\n'
    );
    // The legacy tree is cleaned up once everything under it has moved.
    expect(fs.existsSync(from)).toBe(false);
  });

  test('never overwrites: a name that already exists at the destination is left in the legacy dir', () => {
    const { from, to } = mkTmpPair();

    fs.mkdirSync(path.join(from, 'demos', 'r1m1'), { recursive: true });
    fs.writeFileSync(path.join(from, 'demos', 'r1m1', 'match.dem'), 'legacy-bytes');
    fs.mkdirSync(path.join(to, 'demos', 'r1m1'), { recursive: true });
    fs.writeFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'current-bytes');

    const stats = mergeLegacyDataDir(from, to);

    expect(stats).toEqual({ moved: 0, skipped: 1 });
    // The newer file already in place under DATA_DIR is untouched.
    expect(fs.readFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'utf8')).toBe(
      'current-bytes'
    );
    // The conflicting legacy copy is left behind rather than lost.
    expect(fs.readFileSync(path.join(from, 'demos', 'r1m1', 'match.dem'), 'utf8')).toBe(
      'legacy-bytes'
    );
  });

  test('merges into an existing destination directory instead of clobbering its other files', () => {
    const { from, to } = mkTmpPair();

    fs.mkdirSync(path.join(from, 'demos', 'r2m1'), { recursive: true });
    fs.writeFileSync(path.join(from, 'demos', 'r2m1', 'match.dem'), 'r2m1-bytes');
    fs.mkdirSync(path.join(to, 'demos', 'r1m1'), { recursive: true });
    fs.writeFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'r1m1-bytes');

    const stats = mergeLegacyDataDir(from, to);

    expect(stats).toEqual({ moved: 1, skipped: 0 });
    expect(fs.readFileSync(path.join(to, 'demos', 'r2m1', 'match.dem'), 'utf8')).toBe('r2m1-bytes');
    // The file already under `to/demos/` before the merge survives untouched.
    expect(fs.readFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'utf8')).toBe('r1m1-bytes');
  });

  test('is idempotent: a second run against the same pair is a no-op', () => {
    const { from, to } = mkTmpPair();

    fs.mkdirSync(path.join(from, 'demos', 'r1m1'), { recursive: true });
    fs.writeFileSync(path.join(from, 'demos', 'r1m1', 'match.dem'), 'demo-bytes');

    expect(mergeLegacyDataDir(from, to)).toEqual({ moved: 1, skipped: 0 });
    expect(fs.existsSync(from)).toBe(false);

    // The legacy directory is gone; recreating it empty (as a fresh
    // `fs.existsSync` check in `migrateLegacyDataDir` would see) is a no-op.
    fs.mkdirSync(from, { recursive: true });
    expect(mergeLegacyDataDir(from, to)).toEqual({ moved: 0, skipped: 0 });
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'utf8')).toBe('demo-bytes');
  });

  test('leaves an empty destination alone when the legacy directory is empty', () => {
    const { from, to } = mkTmpPair();

    const stats = mergeLegacyDataDir(from, to);

    expect(stats).toEqual({ moved: 0, skipped: 0 });
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readdirSync(to)).toEqual([]);
  });

  test('falls back to copy-then-delete when rename crosses devices (EXDEV)', () => {
    // Caught by a real `docker/Dockerfile` build during development: `rename`
    // fails with EXDEV between the container's writable layer (legacy dir)
    // and a bind-mounted volume (DATA_DIR), which are different filesystems.
    // The first version of this migration only tried `rename` and silently
    // left every legacy file behind when that happened. Simulated here by
    // making `fs.renameSync` throw EXDEV for this test only.
    const { from, to } = mkTmpPair();

    fs.mkdirSync(path.join(from, 'demos', 'r1m1'), { recursive: true });
    fs.writeFileSync(path.join(from, 'demos', 'r1m1', 'match.dem'), 'demo-bytes');
    fs.mkdirSync(path.join(from, 'logs', 'events'), { recursive: true });
    fs.writeFileSync(path.join(from, 'logs', 'events', 'events-2026-01-01.log'), '{}\n');

    const originalRename = fs.renameSync;
    (fs as { renameSync: typeof fs.renameSync }).renameSync = () => {
      const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    };

    let stats: { moved: number; skipped: number };
    try {
      stats = mergeLegacyDataDir(from, to);
    } finally {
      (fs as { renameSync: typeof fs.renameSync }).renameSync = originalRename;
    }

    expect(stats).toEqual({ moved: 2, skipped: 0 });
    expect(fs.readFileSync(path.join(to, 'demos', 'r1m1', 'match.dem'), 'utf8')).toBe('demo-bytes');
    expect(fs.readFileSync(path.join(to, 'logs', 'events', 'events-2026-01-01.log'), 'utf8')).toBe(
      '{}\n'
    );
    // Copied out and removed from the legacy side, not left behind.
    expect(fs.existsSync(from)).toBe(false);
  });
});
