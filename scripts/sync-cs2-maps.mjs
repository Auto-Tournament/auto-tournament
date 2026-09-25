#!/usr/bin/env node
/* global fetch */
/**
 * Refresh the CS2 map catalogue the CS2 module ships with, from the
 * cs2-server-manager repo.
 *
 * `api/src/integrations/cs2/maps/bundled-maps.json` is a committed copy of
 * `map_thumbnails/maps.json` (written by `csm extract-map-data` from the game
 * files), byte for byte. The CS2 module fetches the live file on boot and on
 * "Sync CS2 maps"; when it cannot (offline, air-gapped, a GitHub outage) it
 * uses this copy, so a fresh install still gets its maps and the Active Duty
 * pool, and the specs run without the network.
 *
 * Committed rather than fetched during the build, like `api/bundled-packs/`
 * (scripts/sync-bundled-packs.mjs): review sees every change to the list.
 *
 * usage:
 *   node scripts/sync-cs2-maps.mjs                        # from GitHub
 *   node scripts/sync-cs2-maps.mjs ../cs2-server-manager  # from a local clone
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'api', 'src', 'integrations', 'cs2', 'maps', 'bundled-maps.json');
const REMOTE =
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails/maps.json';

const source = process.argv[2];

async function read() {
  if (source) return fs.readFile(path.join(path.resolve(source), 'map_thumbnails', 'maps.json'), 'utf8');
  const response = await fetch(REMOTE);
  if (!response.ok) throw new Error(`maps.json: ${response.status} ${response.statusText}`);
  return response.text();
}

const text = await read();
const file = JSON.parse(text);
if (!Array.isArray(file.maps) || !Array.isArray(file.activeDuty)) {
  throw new Error('maps.json has no maps or activeDuty list');
}
for (const map of file.maps) {
  if (typeof map?.id !== 'string' || typeof map?.name !== 'string' || typeof map?.images?.full !== 'string') {
    throw new Error(`maps.json: an entry without id, name or images.full: ${JSON.stringify(map)}`);
  }
}

await fs.writeFile(TARGET, text);
console.log(
  `Synced ${file.maps.length} maps (patch ${file.patchVersion ?? '?'}, build ${file.buildId ?? '?'}); ` +
    `Active Duty: ${file.activeDuty.join(', ')}`
);
