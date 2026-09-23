import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from '@playwright/test';
import { moveMapImages } from '../../api/src/config/migrateLegacyMapImages';

/**
 * The map-images legacy-directory migration.
 *
 * Regression test for the bug fixed alongside this file: uploaded map images
 * were written under `PUBLIC_DIR`, which is build output baked into the
 * container image rather than the bind-mounted volume, so every container
 * recreate -- i.e. every update -- deleted them. `MAP_IMAGES_DIR` now lives
 * under `DATA_DIR`; `config/migrateLegacyMapImages.ts` moves anything the
 * old locations still hold into it on startup.
 *
 * `MAP_IMAGES_DIR`/`LEGACY_MAP_IMAGES_DIRS` are computed once from this
 * module's real `__dirname`, so they aren't practical to parametrize here.
 * This exercises `moveMapImages`, the move the real migration is built on,
 * against throwaway directories -- covering the safety properties the fix
 * depends on: never overwrite, idempotent, and the cross-device (`EXDEV`)
 * rename that the container-layer-to-volume move actually hits.
 *
 * @tag api
 * @tag maps
 * @tag regression
 */

function mkTmpPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-map-images-migration-'));
  const from = path.join(root, 'legacy');
  const to = path.join(root, 'data-map-images');
  fs.mkdirSync(from, { recursive: true });
  return { root, from, to };
}

test.describe('moveMapImages', () => {
  test('moves images out of the legacy directory and removes it', () => {
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_dust2.png'), 'dust2-bytes');
    fs.writeFileSync(path.join(from, 'de_mirage.jpg'), 'mirage-bytes');

    const stats = moveMapImages(from, to);

    expect(stats.moved).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stats.movedNames.sort()).toEqual(['de_dust2.png', 'de_mirage.jpg']);
    expect(fs.readFileSync(path.join(to, 'de_dust2.png'), 'utf8')).toBe('dust2-bytes');
    expect(fs.readFileSync(path.join(to, 'de_mirage.jpg'), 'utf8')).toBe('mirage-bytes');
    // Emptied, so the legacy directory itself is cleaned up.
    expect(fs.existsSync(from)).toBe(false);
  });

  test('creates the destination directory when it does not exist yet', () => {
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_nuke.png'), 'nuke-bytes');
    expect(fs.existsSync(to)).toBe(false);

    expect(moveMapImages(from, to).moved).toBe(1);
    expect(fs.readFileSync(path.join(to, 'de_nuke.png'), 'utf8')).toBe('nuke-bytes');
  });

  test('never overwrites: a name already at the destination is left in the legacy dir', () => {
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_dust2.png'), 'legacy-bytes');
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, 'de_dust2.png'), 'current-bytes');

    const stats = moveMapImages(from, to);

    expect(stats).toMatchObject({ moved: 0, skipped: 1 });
    // The newer image already on the volume wins.
    expect(fs.readFileSync(path.join(to, 'de_dust2.png'), 'utf8')).toBe('current-bytes');
    // The conflicting legacy copy is left behind rather than deleted.
    expect(fs.readFileSync(path.join(from, 'de_dust2.png'), 'utf8')).toBe('legacy-bytes');
  });

  test('leaves other images at the destination untouched', () => {
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_mirage.png'), 'mirage-bytes');
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, 'de_dust2.png'), 'dust2-bytes');

    expect(moveMapImages(from, to).moved).toBe(1);
    expect(fs.readFileSync(path.join(to, 'de_mirage.png'), 'utf8')).toBe('mirage-bytes');
    expect(fs.readFileSync(path.join(to, 'de_dust2.png'), 'utf8')).toBe('dust2-bytes');
  });

  test('is idempotent: a second run against the same pair is a no-op', () => {
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_dust2.png'), 'dust2-bytes');

    expect(moveMapImages(from, to).moved).toBe(1);
    expect(fs.existsSync(from)).toBe(false);

    // The legacy directory is gone; recreating it empty (what a fresh
    // `existsSync` check in `migrateLegacyMapImages` would see on the next
    // start) moves nothing and leaves the migrated image alone.
    fs.mkdirSync(from, { recursive: true });
    expect(moveMapImages(from, to)).toMatchObject({ moved: 0, skipped: 0 });
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'de_dust2.png'), 'utf8')).toBe('dust2-bytes');
  });

  test('ignores subdirectories and other non-file entries', () => {
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_dust2.png'), 'dust2-bytes');
    fs.mkdirSync(path.join(from, 'thumbnails'), { recursive: true });

    const stats = moveMapImages(from, to);

    expect(stats).toMatchObject({ moved: 1, skipped: 0 });
    expect(fs.existsSync(path.join(to, 'thumbnails'))).toBe(false);
    // The directory kept the legacy dir non-empty, so it isn't removed.
    expect(fs.existsSync(path.join(from, 'thumbnails'))).toBe(true);
  });

  test('falls back to copy-then-delete when rename crosses devices (EXDEV)', () => {
    // The real case this migration exists for: the legacy directories sit in
    // the container's writable layer while MAP_IMAGES_DIR is a bind-mounted
    // volume -- different filesystems, where `rename` fails with EXDEV. The
    // equivalent DATA_DIR migration (#292) hit exactly this against a real
    // Docker build. A same-filesystem temp dir can't reproduce it, so
    // `fs.renameSync` is made to throw EXDEV for this test only.
    const { from, to } = mkTmpPair();

    fs.writeFileSync(path.join(from, 'de_dust2.png'), 'dust2-bytes');
    fs.writeFileSync(path.join(from, 'de_mirage.jpg'), 'mirage-bytes');

    const originalRename = fs.renameSync;
    (fs as { renameSync: typeof fs.renameSync }).renameSync = () => {
      const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    };

    let stats: { moved: number; skipped: number; movedNames: string[] };
    try {
      stats = moveMapImages(from, to);
    } finally {
      (fs as { renameSync: typeof fs.renameSync }).renameSync = originalRename;
    }

    expect(stats).toMatchObject({ moved: 2, skipped: 0 });
    expect(fs.readFileSync(path.join(to, 'de_dust2.png'), 'utf8')).toBe('dust2-bytes');
    expect(fs.readFileSync(path.join(to, 'de_mirage.jpg'), 'utf8')).toBe('mirage-bytes');
    // Copied out and removed from the legacy side, not left behind.
    expect(fs.existsSync(from)).toBe(false);
  });
});
