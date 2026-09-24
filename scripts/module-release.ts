#!/usr/bin/env tsx
/**
 * Build, sign and verify code-module releases (DESIGN-modules §10.3, §10.4).
 *
 *   tsx scripts/module-release.ts pack <module-folder> --out <dir> [--unsigned | --key <pem>]
 *       [--url-base <url>] [--snapshot <dir>] [--icon <file.svg>] [--description <text>]
 *       Pack the folder into <id>-<version>.atmod and write catalog-entry.json
 *       next to it. With --unsigned (what the release workflows do) that is
 *       all: `scripts/sign-module.mjs` signs it later, in a job that installs
 *       nothing. Otherwise it also signs it here and writes the .sig — for
 *       local and CI builds with a throwaway key; the private key comes from
 *       --key (a PEM file) or MODULE_SIGNING_KEY (the PEM text) and is never
 *       printed. With --snapshot, also copy the release into that
 *       offline-snapshot folder and list it in the folder's index.json (the
 *       image's bundled-modules). --icon and --description describe the
 *       module in the catalog; the icon is copied into the snapshot as
 *       icons/<id>.svg, and catalog-entry.json names that same path, which is
 *       where the tile goes in Auto-Tournament/packs.
 *
 *   tsx scripts/module-release.ts verify <file.atmod> [--sig <file.sig>]
 *       Verify a release with exactly the check the platform runs, against
 *       the keys compiled into it (and MODULE_TRUSTED_KEYS). Exits non-zero
 *       if it would be refused.
 *
 *   tsx scripts/module-release.ts keygen --out <private.pem>
 *       Make a new Ed25519 key pair. Writes the private key to --out with
 *       mode 0600 (refusing to overwrite) and prints only the public key and
 *       its key id, ready for api/src/modules/trustedKeys.ts.
 *
 * The same code the platform verifies with signs here: archive.ts and
 * signature.ts, no other dependency.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { collectDirectory, writeModuleArchive } from '../api/src/modules/archive';
import { compatibilityProblem, parseManifest } from '../api/src/modules/manifest';
import { sha256Hex, signModuleArchive, verifyModuleRelease } from '../api/src/modules/signature';
import { keyIdFor } from '../api/src/modules/trustedKeys';

function fail(message: string): never {
  console.error(`module-release: ${message}`);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) fail(`${name} needs a value`);
  return value;
}

function loadPrivateKey(file: string | undefined): crypto.KeyObject {
  const pem = file ? fs.readFileSync(file, 'utf8') : process.env.MODULE_SIGNING_KEY;
  if (!pem) fail('no signing key: pass --key <pem> or set MODULE_SIGNING_KEY');
  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(pem);
  } catch {
    // Never echo the key material, not even in an error.
    fail('the signing key is not a readable PEM private key');
  }
  if (key.asymmetricKeyType !== 'ed25519') fail('the signing key is not an Ed25519 key');
  return key;
}

function rawPublicKey(key: crypto.KeyObject): string {
  const jwk = crypto.createPublicKey(key).export({ format: 'jwk' });
  return Buffer.from(jwk.x as string, 'base64url').toString('base64');
}

async function pack(args: string[]): Promise<void> {
  const folder = args[0];
  if (!folder || folder.startsWith('--')) fail('pack needs a module folder');
  const out = option(args, '--out') ?? fail('pack needs --out <dir>');
  const urlBase = option(args, '--url-base');
  const snapshot = option(args, '--snapshot');
  const iconFile = option(args, '--icon');
  const description = option(args, '--description');
  const unsigned = args.includes('--unsigned');
  const key = unsigned ? null : loadPrivateKey(option(args, '--key'));

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(folder, 'module.json'), 'utf8'));
  } catch (error) {
    fail(`cannot read ${folder}/module.json: ${(error as Error).message}`);
  }
  const id = (raw as { id?: unknown }).id;
  const parsed = parseManifest(raw, typeof id === 'string' ? id : '');
  if (!parsed.ok) fail(parsed.reason);
  const manifest = parsed.manifest;
  const incompatible = compatibilityProblem(manifest);
  if (incompatible) fail(`this platform would refuse it: ${incompatible}`);

  const entries = await collectDirectory(folder);
  for (const required of [manifest.server, ...(manifest.client ? [manifest.client] : [])]) {
    if (!entries.some((entry) => entry.path === required)) fail(`${required} is missing from ${folder}`);
  }
  const archive = writeModuleArchive(entries);
  const signature = key ? signModuleArchive(archive, { id: manifest.id, version: manifest.version }, key) : null;

  const file = `${manifest.id}-${manifest.version}.atmod`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, file), archive);
  if (signature) fs.writeFileSync(path.join(out, `${file}.sig`), `${JSON.stringify(signature, null, 2)}\n`);

  const release = {
    version: manifest.version,
    serverApi: manifest.serverApi,
    clientApi: manifest.clientApi,
    ...(urlBase ? { url: `${urlBase.replace(/\/$/, '')}/${file}` } : {}),
    sha256: sha256Hex(archive),
    size: archive.length,
  };
  const about = {
    ...(description ? { description } : {}),
    ...(iconFile ? { icon: `icons/${manifest.id}.svg` } : {}),
  };
  const entry = { id: manifest.id, name: manifest.name, ...about, releases: [release] };
  fs.writeFileSync(path.join(out, 'catalog-entry.json'), `${JSON.stringify(entry, null, 2)}\n`);

  if (snapshot) {
    fs.mkdirSync(snapshot, { recursive: true });
    fs.copyFileSync(path.join(out, file), path.join(snapshot, file));
    if (signature) fs.copyFileSync(path.join(out, `${file}.sig`), path.join(snapshot, `${file}.sig`));
    if (iconFile) {
      fs.mkdirSync(path.join(snapshot, 'icons'), { recursive: true });
      fs.copyFileSync(iconFile, path.join(snapshot, 'icons', `${manifest.id}.svg`));
    }
    const indexFile = path.join(snapshot, 'index.json');
    const index = fs.existsSync(indexFile)
      ? (JSON.parse(fs.readFileSync(indexFile, 'utf8')) as { schema: number; modules: Array<Record<string, unknown>> })
      : { schema: 1, modules: [] };
    const others = index.modules.filter((m) => m.id !== manifest.id);
    const snapshotRelease = { ...release, file };
    delete (snapshotRelease as { url?: string }).url;
    index.modules = [...others, { id: manifest.id, name: manifest.name, ...about, releases: [snapshotRelease] }].sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );
    fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  }

  console.log(
    `Built ${file} (${archive.length} bytes, sha256 ${release.sha256}), ` +
      (signature ? `signed by key ${signature.keyId}` : 'unsigned') +
      (snapshot ? `, added to ${snapshot}` : '')
  );
}

function verify(args: string[]): void {
  const file = args[0];
  if (!file || file.startsWith('--')) fail('verify needs a .atmod file');
  const sigFile = option(args, '--sig') ?? `${file}.sig`;
  const archive = fs.readFileSync(file);
  const signatureText = fs.readFileSync(sigFile, 'utf8');
  const claimed = JSON.parse(signatureText) as { id?: string; version?: string };
  const result = verifyModuleRelease(archive, signatureText, { id: claimed.id ?? '', version: claimed.version });
  if (!result.ok) fail(`${path.basename(file)} would be refused: ${result.reason}`);
  console.log(`${path.basename(file)}: ${claimed.id}@${claimed.version}, signed by trusted key ${result.key.keyId} (${result.key.label})`);
}

function keygen(args: string[]): void {
  const out = option(args, '--out') ?? fail('keygen needs --out <private.pem>');
  if (fs.existsSync(out)) fail(`${out} already exists; refusing to overwrite a key`);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  fs.writeFileSync(out, pem, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(out, 0o600);
  const publicKey = rawPublicKey(privateKey);
  console.log(`Private key written to ${out} (mode 0600). It is not printed.`);
  console.log(`Public key (base64, raw Ed25519): ${publicKey}`);
  console.log(`Key id: ${keyIdFor(publicKey)}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pack') await pack(args);
  else if (command === 'verify') verify(args);
  else if (command === 'keygen') keygen(args);
  else fail('usage: module-release.ts pack <folder> --out <dir> | verify <file.atmod> | keygen --out <pem>');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
