import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { test, expect } from '@playwright/test';
import {
  ArchiveError,
  extractEntries,
  readModuleArchive,
  writeModuleArchive,
} from '../../api/src/modules/archive';
import { signModuleArchive, verifyModuleRelease } from '../../api/src/modules/signature';
import { keyIdFor, trustedKeys, type TrustedKey } from '../../api/src/modules/trustedKeys';
import {
  allowedRedirectUrl,
  allowedReleaseUrl,
  pickRelease,
  type CatalogRelease,
} from '../../api/src/modules/catalogFeed';

/**
 * The module release format, in process (DESIGN-modules §10.3, §10.4): the
 * archive writer and its strict reader, and the Ed25519 signature every
 * catalog install passes before anything is unpacked.
 *
 * The HTTP side — the catalog endpoints refusing each of these end to end —
 * is `game-catalog.spec.ts`.
 *
 * @tag api
 * @tag modules
 */

function keypair(): { privateKey: crypto.KeyObject; trusted: TrustedKey } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64');
  return { privateKey, trusted: { keyId: keyIdFor(raw), publicKey: raw, label: 'spec' } };
}

const FILES = [
  { path: 'module.json', data: Buffer.from('{"id":"demo"}') },
  { path: 'server/index.js', data: Buffer.from('export default {};\n') },
  { path: `client/${'deep/'.repeat(12)}chunk.js`, data: Buffer.from('export {};\n') },
];

/** A hand-made gzip'd tar with one entry of `type`, for the shapes our writer refuses to make. */
function rawTar(name: string, type: string, data = '', linkname = ''): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, 100);
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${Buffer.byteLength(data).toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.fill(0x20, 148, 156);
  block.write(type, 156);
  block.write(linkname, 157);
  block.write('ustar\0', 257);
  block.write('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(data) / 512) * 512, 0);
  body.write(data);
  return zlib.gzipSync(Buffer.concat([block, body, Buffer.alloc(1024, 0)]));
}

test.describe('Module archive', () => {
  test('round-trips, byte-identically for the same tree', () => {
    const one = writeModuleArchive(FILES);
    const two = writeModuleArchive([...FILES].reverse());
    expect(one.equals(two)).toBe(true);
    const read = readModuleArchive(one);
    expect(read.map((entry) => entry.path)).toEqual([...FILES.map((f) => f.path)].sort());
    expect(read.find((entry) => entry.path === 'server/index.js')?.data.toString()).toBe('export default {};\n');
  });

  test('the writer refuses names the reader would refuse', () => {
    for (const bad of ['../x.js', '/abs.js', 'a/../b.js', 'a//b.js', 'a\\b.js', '.hidden/..', 'sp ace.js']) {
      expect(() => writeModuleArchive([{ path: bad, data: Buffer.from('x') }]), bad).toThrow(ArchiveError);
    }
    expect(() =>
      writeModuleArchive([
        { path: 'A.js', data: Buffer.from('1') },
        { path: 'a.js', data: Buffer.from('2') },
      ])
    ).toThrow(/twice/);
  });

  test('the reader refuses traversal, absolute paths, links, devices and pax headers', () => {
    const cases: Array<[Buffer, RegExp]> = [
      [rawTar('../escape.txt', '0', 'x'), /climbs out/],
      [rawTar('/etc/cron.d/x', '0', 'x'), /absolute/],
      [rawTar('server/link', '2', '', '/etc/passwd'), /symlink/],
      [rawTar('server/hard', '1', '', 'module.json'), /hard link/],
      [rawTar('dev', '3'), /character device/],
      [rawTar('fifo', '6'), /FIFO/],
      [rawTar('PaxHeader', 'x', '30 path=../../escape\n'), /pax header/],
      [rawTar('././@LongLink', 'L', '../../escape'), /GNU long name|not a plain/],
    ];
    for (const [archive, reason] of cases) {
      expect(() => readModuleArchive(archive)).toThrow(reason);
    }
  });

  test('the reader refuses a bad checksum, a truncated archive and non-gzip', () => {
    const good = zlib.gunzipSync(writeModuleArchive(FILES));
    const corrupt = Buffer.from(good);
    corrupt[10] ^= 0xff;
    expect(() => readModuleArchive(zlib.gzipSync(corrupt))).toThrow(/checksum/);
    expect(() => readModuleArchive(zlib.gzipSync(good.subarray(0, 700)))).toThrow(/truncated/);
    expect(() => readModuleArchive(Buffer.from('not gzip at all'))).toThrow(/gzip/);
  });

  test('size limits hold, including a zip bomb', () => {
    const bomb = writeModuleArchive([{ path: 'big.bin', data: Buffer.alloc(8 * 1024 * 1024, 0) }]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(() => readModuleArchive(bomb, { maxUnpackedBytes: 1024 * 1024, maxFileBytes: 64 * 1024 * 1024, maxEntries: 10 })).toThrow(
      /size limit/
    );
    expect(() => readModuleArchive(bomb, { maxUnpackedBytes: 64 * 1024 * 1024, maxFileBytes: 1024, maxEntries: 10 })).toThrow(
      /file size limit/
    );
    const many = writeModuleArchive(Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.js`, data: Buffer.from('x') })));
    expect(() => readModuleArchive(many, { maxUnpackedBytes: 1e6, maxFileBytes: 1e6, maxEntries: 10 })).toThrow(/entries/);
  });

  test('extraction writes plain files inside the target only', async () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atmod-')), 'module');
    await extractEntries(readModuleArchive(writeModuleArchive(FILES)), root);
    const index = path.join(root, 'server', 'index.js');
    expect(fs.readFileSync(index, 'utf8')).toBe('export default {};\n');
    expect(fs.lstatSync(index).isSymbolicLink()).toBe(false);
    expect((fs.statSync(index).mode & 0o777).toString(8)).toBe('644');
    // The target must be new: extraction never writes into an existing folder.
    await expect(extractEntries([], root)).rejects.toThrow();
  });
});

test.describe('Module signature', () => {
  const archive = writeModuleArchive(FILES);
  const { privateKey, trusted } = keypair();
  const signature = JSON.stringify(signModuleArchive(archive, { id: 'demo', version: '1.2.3' }, privateKey));

  test('a release signed by a trusted key verifies', () => {
    const result = verifyModuleRelease(archive, signature, { id: 'demo', version: '1.2.3' }, [trusted]);
    expect(result.ok).toBe(true);
  });

  test('a changed byte, another key, a revoked key or a different id is refused', () => {
    const tampered = Buffer.from(archive);
    tampered[20] ^= 1;
    const other = keypair();
    const cases: Array<[ReturnType<typeof verifyModuleRelease>, RegExp]> = [
      [verifyModuleRelease(tampered, signature, { id: 'demo' }, [trusted]), /changed after signing/],
      [verifyModuleRelease(archive, signature, { id: 'demo' }, [other.trusted]), /does not trust/],
      [verifyModuleRelease(archive, signature, { id: 'demo' }, [{ ...trusted, revoked: true }]), /revoked/],
      [verifyModuleRelease(archive, signature, { id: 'other' }, [trusted]), /not 'other'/],
      [verifyModuleRelease(archive, signature, { id: 'demo', version: '9.9.9' }, [trusted]), /not 9\.9\.9/],
      [verifyModuleRelease(archive, signature, { id: 'demo', sha256: 'a'.repeat(64) }, [trusted]), /catalog lists/],
      [verifyModuleRelease(archive, 'not json', { id: 'demo' }, [trusted]), /not valid JSON/],
    ];
    for (const [result, reason] of cases) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(reason);
    }
  });

  test('a signature whose bytes were swapped for another key id is refused', () => {
    const other = keypair();
    // Claim the trusted key's id, sign with another key.
    const forged = { ...JSON.parse(signature), signature: signModuleArchive(archive, { id: 'demo', version: '1.2.3' }, other.privateKey).signature };
    const result = verifyModuleRelease(archive, JSON.stringify(forged), { id: 'demo' }, [trusted]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not verify/);
  });
});

test.describe('The standalone signer (scripts/sign-module.mjs)', () => {
  // What the release workflows sign with, in a job that installs nothing:
  // its output must be exactly what the platform verifies.
  const SIGNER = path.join(__dirname, '../../scripts/sign-module.mjs');

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atsign-'));
    const { privateKey, trusted } = keypair();
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
    const archive = writeModuleArchive(FILES);
    const file = path.join(dir, 'demo-1.2.3.atmod');
    fs.writeFileSync(file, archive);
    return { dir, pem, trusted, archive, file };
  }

  test('signs what the platform verifies, and never prints the key', () => {
    const { pem, trusted, archive, file } = setup();
    const output = execFileSync(process.execPath, [SIGNER, file, 'demo', '1.2.3'], {
      env: { ...process.env, MODULE_SIGNING_KEY: pem },
      encoding: 'utf8',
    });
    expect(output).toContain(trusted.keyId);
    expect(output).not.toContain('PRIVATE KEY');
    const result = verifyModuleRelease(archive, fs.readFileSync(`${file}.sig`), { id: 'demo', version: '1.2.3' }, [trusted]);
    expect(result.ok).toBe(true);
  });

  test('--entry refuses an archive that is not the one the build described', () => {
    const { dir, pem } = setup();
    fs.writeFileSync(
      path.join(dir, 'catalog-entry.json'),
      JSON.stringify({ id: 'demo', name: 'Demo', releases: [{ version: '1.2.3', sha256: 'a'.repeat(64) }] })
    );
    const run = spawnSync(process.execPath, [SIGNER, '--entry', path.join(dir, 'catalog-entry.json')], {
      env: { ...process.env, MODULE_SIGNING_KEY: pem },
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/not the archive that was built/);
    expect(fs.existsSync(path.join(dir, 'demo-1.2.3.atmod.sig'))).toBe(false);
  });

  test('refuses a key that is not an Ed25519 PEM, without echoing it', () => {
    const { file } = setup();
    const run = spawnSync(process.execPath, [SIGNER, file, 'demo', '1.2.3'], {
      env: { ...process.env, MODULE_SIGNING_KEY: 'not-a-key-secret-material' },
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).not.toContain('secret-material');
  });
});

test.describe('Trusted keys', () => {
  test('the platform trusts its module release key, and its id is derived from it', () => {
    const keys = trustedKeys();
    const release = keys.find((key) => key.keyId === '65322c04183b7d1d');
    expect(release, 'the 2026 release key is compiled in').toBeTruthy();
    expect(keyIdFor(release!.publicKey)).toBe(release!.keyId);
    expect(release!.revoked).toBeFalsy();
  });

  test('MODULE_TRUSTED_KEYS adds keys, but cannot un-revoke or replace a compiled one', () => {
    const extra = keypair().trusted;
    const before = process.env.MODULE_TRUSTED_KEYS;
    try {
      process.env.MODULE_TRUSTED_KEYS = `${extra.publicKey}, not-a-key ,${trustedKeys()[0].publicKey}`;
      const keys = trustedKeys();
      expect(keys.find((key) => key.keyId === extra.keyId)?.label).toBe('MODULE_TRUSTED_KEYS');
      // The compiled entry wins over the same key from the environment.
      expect(keys.filter((key) => key.keyId === '65322c04183b7d1d')).toHaveLength(1);
      expect(keys.find((key) => key.keyId === '65322c04183b7d1d')?.label).not.toBe('MODULE_TRUSTED_KEYS');
    } finally {
      if (before === undefined) delete process.env.MODULE_TRUSTED_KEYS;
      else process.env.MODULE_TRUSTED_KEYS = before;
    }
  });
});

test.describe('Catalog feed rules', () => {
  const release = (version: string, serverApi: string, from: 'remote' | 'snapshot' = 'remote'): CatalogRelease => ({
    version,
    serverApi,
    clientApi: '^0.2.0',
    sha256: null,
    size: null,
    from,
  });

  test('picks the newest release this platform can run, preferring the download', () => {
    const picked = pickRelease(
      [release('1.0.0', '^0.1.0'), release('2.0.0', '^0.1.0', 'snapshot'), release('2.0.0', '^0.1.0'), release('3.0.0', '^9.0.0')],
      { serverApi: '0.1.0', clientApi: '0.2.0' }
    );
    expect(picked.ok && picked.release.version).toBe('2.0.0');
    expect(picked.ok && picked.release.from).toBe('remote');
    const none = pickRelease([release('3.0.0', '^9.0.0')], { serverApi: '0.1.0', clientApi: '0.2.0' });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toMatch(/\^9\.0\.0/);
  });

  test('a release download may redirect only to GitHub\'s asset hosts, over https', () => {
    for (const good of [
      'https://objects.githubusercontent.com/github-production-release-asset/1/2?X-Amz=1',
      'https://release-assets.githubusercontent.com/github-production-release-asset/3/4',
    ]) {
      expect(allowedRedirectUrl(new URL(good)), good).toBe(true);
    }
    for (const bad of [
      'http://objects.githubusercontent.com/x',
      'https://objects.githubusercontent.com:8443/x',
      'https://evil.objects.githubusercontent.com.example/x',
      'https://user:pass@objects.githubusercontent.com/x',
      'https://example.com/x',
      'https://github.com/Someone-Else/x.atmod',
    ]) {
      expect(allowedRedirectUrl(new URL(bad)), bad).toBe(false);
    }
  });

  test('release URLs must be ours', () => {
    const prefix = 'https://github.com/Auto-Tournament/';
    expect(allowedReleaseUrl('https://github.com/Auto-Tournament/auto-tournament/releases/download/module-cs2-v1.0.0/cs2-1.0.0.atmod', prefix)).toBe(true);
    for (const bad of [
      'http://github.com/Auto-Tournament/x.atmod',
      'https://github.com/Someone-Else/x.atmod',
      'https://github.com/Auto-Tournament/../Someone-Else/x.atmod',
      'https://user:pass@github.com/Auto-Tournament/x.atmod',
      'https://github.com.evil.example/Auto-Tournament/x.atmod',
      'https://github.com/Auto-Tournament/x.atmod?redirect=https://evil.example',
      'file:///etc/passwd',
    ]) {
      expect(allowedReleaseUrl(bad, prefix), bad).toBe(false);
    }
  });
});
