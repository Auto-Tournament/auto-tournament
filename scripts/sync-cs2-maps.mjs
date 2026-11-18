#!/usr/bin/env node
/**
 * Refresh the CS2 map catalogue the CS2 module ships with, from a maps.json
 * a csm host built (a platform keeps the last one in
 * DATA_DIR/cache/cs2-catalog/maps.json; `csm extract-map-data` writes one too).
 *
 * `api/src/integrations/cs2/maps/bundled-maps.json` is that file, byte for
 * byte. The CS2 module asks a csm host on boot and on "Sync CS2 maps"; with
 * no host it uses this copy, so a fresh install still gets its maps and the
 * Active Duty pool, and the specs run without the network.
 *
 * Committed rather than fetched during the build, like `api/bundled-packs/`
 * (scripts/sync-bundled-packs.mjs): review sees every change to the list.
 *
 * usage:
 *   node scripts/sync-cs2-maps.mjs <path/to/maps.json>
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'api', 'src', 'integrations', 'cs2', 'maps', 'bundled-maps.json');
const source = process.argv[2];
if (!source) throw new Error('usage: node scripts/sync-cs2-maps.mjs <path/to/maps.json>');

const text = await fs.readFile(path.resolve(source), 'utf8');
const file = JSON.parse(text);
if (!Array.isArray(file.maps) || !Array.isArray(file.activeDuty)) {
  throw new Error('maps.json has no maps or activeDuty list');
}
for (const map of file.maps) {
  if (
    typeof map?.id !== 'string' ||
    typeof map?.name !== 'string' ||
    typeof map?.images?.full !== 'string'
  ) {
    throw new Error(`maps.json: an entry without id, name or images.full: ${JSON.stringify(map)}`);
  }
}

await fs.writeFile(TARGET, text);
console.log(
  `Synced ${file.maps.length} maps (patch ${file.patchVersion ?? '?'}, build ${file.buildId ?? '?'}); ` +
    `Active Duty: ${file.activeDuty.join(', ')}`
);
