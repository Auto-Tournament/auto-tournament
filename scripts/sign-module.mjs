#!/usr/bin/env node
/**
 * Sign code-module releases (DESIGN-modules §10.4) — the only place the
 * release signing key is ever used.
 *
 * Standalone on purpose: Node's built-in `crypto`, `fs` and `path`, nothing
 * else. The workflows run it in a job that has the key and has installed no
 * dependency at all, so no package's install script, bundler plugin or
 * transitive import ever runs in a process that can read the key. Everything
 * that needs `yarn install` (building the module, checking the signature
 * against the platform's own verifier) runs in other jobs, without it.
 *
 * It writes exactly what `api/src/modules/signature.ts` verifies:
 *
 *   { "schema": 1, "algorithm": "ed25519", "keyId": "<16 hex>",
 *     "id": "cs2", "version": "3.0.0", "sha256": "<hex of the archive>",
 *     "signature": "<base64 of Ed25519 over the message below>" }
 *
 *   auto-tournament-module\n1\n<id>\n<version>\n<sha256>\n
 *
 * usage (the key is the PEM text of an Ed25519 private key, in the
 * MODULE_SIGNING_KEY environment variable; it is never printed):
 *
 *   node scripts/sign-module.mjs --entry <dir>/catalog-entry.json
 *       sign the release a module build described: <dir>/<id>-<version>.atmod,
 *       whose sha256 must be the one catalog-entry.json lists
 *   node scripts/sign-module.mjs --snapshot <dir>
 *       sign every release <dir>/index.json lists (the image's offline snapshot)
 *   node scripts/sign-module.mjs <file.atmod> <id> <version>
 *       sign one archive
 */

import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SNAPSHOT_FILE = /^[a-z0-9][a-z0-9.-]*\.atmod$/;

function fail(message) {
  console.error(`sign-module: ${message}`);
  process.exit(1);
}

function signingKey() {
  const pem = process.env.MODULE_SIGNING_KEY;
  if (!pem) fail('MODULE_SIGNING_KEY is not set');
  let key;
  try {
    key = crypto.createPrivateKey(pem);
  } catch {
    // Never echo key material, not even in an error.
    fail('MODULE_SIGNING_KEY is not a readable PEM private key');
  }
  if (key.asymmetricKeyType !== 'ed25519') fail('MODULE_SIGNING_KEY is not an Ed25519 key');
  return key;
}

function keyIdOf(key) {
  const raw = Buffer.from(crypto.createPublicKey(key).export({ format: 'jwk' }).x, 'base64url');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function sign(key, file, id, version, expectedSha256) {
  if (!MODULE_ID.test(id) || id.length > 64) fail(`'${id}' is not a module id`);
  if (!VERSION.test(version)) fail(`'${version}' is not a semver version`);
  const archive = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) {
    fail(`${path.basename(file)} is not the archive that was built (sha256 differs)`);
  }
  const message = Buffer.from(`auto-tournament-module\n1\n${id}\n${version}\n${sha256}\n`, 'utf8');
  const signature = {
    schema: 1,
    algorithm: 'ed25519',
    keyId: keyIdOf(key),
    id,
    version,
    sha256,
    signature: crypto.sign(null, message, key).toString('base64'),
  };
  fs.writeFileSync(`${file}.sig`, `${JSON.stringify(signature, null, 2)}\n`);
  console.log(`Signed ${path.basename(file)} (${id}@${version}, sha256 ${sha256}) with key ${signature.keyId}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--entry' && args[1]) {
  const entry = readJson(args[1]);
  const release = Array.isArray(entry.releases) ? entry.releases[0] : null;
  if (typeof entry.id !== 'string' || !release || typeof release.version !== 'string') {
    fail(`${args[1]} names no module and release`);
  }
  const key = signingKey();
  sign(key, path.join(path.dirname(args[1]), `${entry.id}-${release.version}.atmod`), entry.id, release.version, release.sha256);
} else if (args[0] === '--snapshot' && args[1]) {
  const dir = path.resolve(args[1]);
  const index = readJson(path.join(dir, 'index.json'));
  const modules = Array.isArray(index.modules) ? index.modules : [];
  const key = signingKey();
  let count = 0;
  for (const module of modules) {
    for (const release of module.releases ?? []) {
      if (typeof release.file !== 'string' || !SNAPSHOT_FILE.test(release.file)) fail(`a release of ${module.id} names no snapshot file`);
      sign(key, path.join(dir, release.file), module.id, release.version, release.sha256);
      count += 1;
    }
  }
  if (count === 0) fail(`${dir}/index.json lists no release to sign`);
} else if (args.length === 3 && !args[0].startsWith('--')) {
  sign(signingKey(), args[0], args[1], args[2], null);
} else {
  fail('usage: sign-module.mjs --entry <catalog-entry.json> | --snapshot <dir> | <file.atmod> <id> <version>');
}
