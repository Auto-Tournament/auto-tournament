#!/usr/bin/env node
/* global fetch */
/**
 * Refresh the game packs the image ships with, from the community repo.
 *
 * `api/bundled-packs/` is a committed snapshot of `Auto-Tournament/packs`:
 * the same `index.json`, `packs/` and `icons/`, byte for byte. A fresh
 * install seeds itself from it on first boot (`seedBundledPacks`), so the
 * games an instance can run on day one come from data, not from a list in the
 * source — and arrive with no network at all, which an index fetched at boot
 * could not promise.
 *
 * Committed rather than fetched during the build so a release is
 * reproducible: the games in an image are the games in its git tree, and
 * review sees every change to them.
 *
 * usage:
 *   node scripts/sync-bundled-packs.mjs              # from GitHub
 *   node scripts/sync-bundled-packs.mjs ../packs     # from a local clone
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'api', 'bundled-packs');
const REMOTE = 'https://raw.githubusercontent.com/Auto-Tournament/packs/main/';

const source = process.argv[2];

async function read(relative) {
  if (source) return fs.readFile(path.join(path.resolve(source), relative), 'utf8');
  const response = await fetch(new URL(relative, REMOTE));
  if (!response.ok) throw new Error(`${relative}: ${response.status} ${response.statusText}`);
  return response.text();
}

/** Refuse anything that would write outside the target, however the index spells it. */
function inside(relative) {
  const resolved = path.resolve(TARGET, relative);
  if (!resolved.startsWith(TARGET + path.sep)) {
    throw new Error(`${relative} resolves outside ${TARGET}`);
  }
  return resolved;
}

const indexText = await read('index.json');
const index = JSON.parse(indexText);
if (index.schema !== 1 || !Array.isArray(index.packs)) {
  throw new Error('index.json is not a schema 1 pack index');
}

// Start clean, so a game removed upstream is removed here too.
await fs.rm(TARGET, { recursive: true, force: true });
await fs.mkdir(path.join(TARGET, 'packs'), { recursive: true });
await fs.mkdir(path.join(TARGET, 'icons'), { recursive: true });
await fs.writeFile(path.join(TARGET, 'index.json'), indexText);

for (const entry of index.packs) {
  const packText = await read(entry.file);
  await fs.writeFile(inside(entry.file), packText);

  const pack = JSON.parse(packText);
  if (pack.icon) {
    // The pack names its tile relative to itself (`../icons/x.svg`).
    const icon = path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), pack.icon));
    await fs.writeFile(inside(icon), await read(icon));
  }
  console.log(`  ${entry.slug}`);
}

console.log(`Synced ${index.packs.length} packs into api/bundled-packs`);
