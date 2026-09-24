import { test, expect } from '@playwright/test';
import {
  compatibilityProblem,
  isSafeEntryPath,
  isValidModuleId,
  parseManifest,
} from '../../api/src/modules/manifest';
import {
  integrationFromNamespace,
  integrationProblem,
} from '../../api/src/modules/validateIntegration';
import { SERVER_API_VERSION, CLIENT_API_VERSION } from '../../api/src/modules/version';
import { listIntegrations } from '../../api/src/integrations/registry';
import { fakeIntegration } from '../../api/src/integrations/fake';

/**
 * `module.json` and the `GameIntegration` shape check: what the disk module
 * loader (api/src/modules/loader.ts) refuses before and after it imports a
 * module's code. Runs in this process; no server, no database.
 *
 * tests/api/code-modules.spec.ts covers the loader end to end against a live
 * API.
 *
 * @tag api
 * @tag modules
 */

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'example',
    name: 'Example',
    version: '1.2.3',
    serverApi: '^0.1.0',
    clientApi: '^0.1.0',
    server: 'server/index.js',
    client: 'client/index.js',
    ...overrides,
  };
}

test.describe('module.json', () => {
  test('the platform publishes its API versions', { tag: ['@api', '@modules'] }, () => {
    expect(SERVER_API_VERSION).toBe('0.1.0');
    expect(CLIENT_API_VERSION).toBe('0.2.2');
  });

  test('module ids are lowercase words joined by hyphens, and never a path', {
    tag: ['@api', '@modules'],
  }, () => {
    for (const id of ['cs2', 'manual-report', 'a', 'fixture-valid-abc123']) {
      expect(isValidModuleId(id), id).toBe(true);
    }
    for (const id of [
      '',
      '..',
      '.',
      'a..b',
      '../x',
      'a/b',
      'a\\b',
      'A',
      'Cs2',
      '-a',
      'a-',
      'a--b',
      'a_b',
      'a.b',
      'a b',
      'a%2fb',
      'x'.repeat(65),
      null,
      42,
    ]) {
      expect(isValidModuleId(id), String(id)).toBe(false);
    }
  });

  test('entry paths stay inside the module folder', { tag: ['@api', '@modules'] }, () => {
    for (const entry of ['server/index.js', 'client/index.js', 'index.mjs', 'a/b/c.cjs']) {
      expect(isSafeEntryPath(entry), entry).toBe(true);
    }
    for (const entry of [
      '',
      '/etc/passwd',
      '../x.js',
      'server/../../x.js',
      './index.js',
      'server//index.js',
      'server\\index.js',
      '...',
      'server/.hidden/..',
    ]) {
      expect(isSafeEntryPath(entry), entry).toBe(false);
    }
  });

  test('a valid manifest parses', { tag: ['@api', '@modules'] }, () => {
    const result = parseManifest(manifest(), 'example');
    expect(result).toEqual({ ok: true, manifest: manifest() });
    // The client half is optional.
    const serverOnly = parseManifest(manifest({ client: undefined }), 'example');
    expect(serverOnly.ok && serverOnly.manifest.client).toBe(null);
    // Keys owned elsewhere (migrations, locales) are not an error.
    expect(parseManifest(manifest({ migrations: 'migrations' }), 'example').ok).toBe(true);
  });

  test('every field is checked strictly', { tag: ['@api', '@modules'] }, () => {
    const refused: Array<[string, unknown, string]> = [
      ['not an object', [], 'must be a JSON object'],
      ['null', null, 'must be a JSON object'],
      ['no id', manifest({ id: undefined }), "'id'"],
      ['a path as id', manifest({ id: '../example' }), 'not a valid module id'],
      ['id with a slash', manifest({ id: 'a/b' }), 'not a valid module id'],
      ['id not the folder', manifest({ id: 'other' }), 'must match'],
      ['empty name', manifest({ name: ' ' }), "'name'"],
      ['version not semver', manifest({ version: '1.0' }), "'version'"],
      ['serverApi not a range', manifest({ serverApi: 'soon' }), "'serverApi'"],
      ['serverApi empty', manifest({ serverApi: '' }), "'serverApi'"],
      ['clientApi missing', manifest({ clientApi: undefined }), "'clientApi'"],
      ['server outside', manifest({ server: '../server.js' }), "'server'"],
      ['server absolute', manifest({ server: '/tmp/x.js' }), "'server'"],
      ['server not js', manifest({ server: 'server/index.ts' }), "'server'"],
      ['server under client/', manifest({ server: 'client/server.js' }), 'served to browsers'],
      ['client outside client/', manifest({ client: 'index.js' }), "'client'"],
      ['client climbing out', manifest({ client: 'client/../server/index.js' }), "'client'"],
      ['client not a string', manifest({ client: 42 }), "'client'"],
    ];
    for (const [label, raw, reason] of refused) {
      const result = parseManifest(raw, 'example');
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.reason, label).toContain(reason);
    }
  });

  test('the API ranges are checked with semver', { tag: ['@api', '@modules'] }, () => {
    const at = { serverApi: '0.1.0', clientApi: '0.1.0' };
    expect(compatibilityProblem(manifest(), at)).toBeNull();
    expect(compatibilityProblem(manifest({ serverApi: '>=0.1.0 <1.0.0' }), at)).toBeNull();

    // A 0.x caret is "this minor only".
    expect(compatibilityProblem(manifest(), { serverApi: '0.2.0', clientApi: '0.1.0' })).toContain(
      'server API ^0.1.0'
    );
    expect(compatibilityProblem(manifest({ serverApi: '^0.3.0' }), at)).toBe(
      'Built for server API ^0.3.0; this platform provides 0.1.0.'
    );
    expect(compatibilityProblem(manifest({ clientApi: '^2.0.0' }), at)).toContain(
      'client API ^2.0.0'
    );
    // No client half: its client range does not matter.
    expect(compatibilityProblem(manifest({ clientApi: '^2.0.0', client: null }), at)).toBeNull();
  });
});

test.describe('GameIntegration shape check', () => {
  test('every built-in integration passes it', { tag: ['@api', '@modules'] }, () => {
    for (const integration of [...listIntegrations(), fakeIntegration]) {
      expect(integrationProblem(integration), integration.id).toBeNull();
    }
  });

  test('a wrong shape is refused with the reason', { tag: ['@api', '@modules'] }, () => {
    const base = { ...fakeIntegration } as Record<string, unknown>;
    const refused: Array<[string, unknown, string]> = [
      ['nothing', undefined, 'no default export'],
      ['a function', () => null, 'no default export'],
      ['no id', { ...base, id: undefined }, "'id'"],
      ['no displayName', { ...base, displayName: '' }, "'displayName'"],
      ['no capabilities', { ...base, capabilities: undefined }, "'capabilities'"],
      ['capability not boolean', { ...base, capabilities: { ...fakeIntegration.capabilities, veto: 'yes' } }, 'capabilities.veto'],
      ['no allocate', { ...base, allocate: undefined }, "'allocate'"],
      ['start not a function', { ...base, start: true }, "'start'"],
      ['clientSlots not an array', { ...base, clientSlots: 'MatchPanel' }, "'clientSlots'"],
      ['catalog a string', { ...base, catalog: 'x' }, "'catalog'"],
      ['claims to be the placeholder', { ...base, notInstalled: 'cs2' }, "'notInstalled'"],
    ];
    for (const [label, value, reason] of refused) {
      expect(integrationProblem(value), label).toContain(reason);
    }
  });

  test('the default export is found in ESM and CommonJS builds', { tag: ['@api', '@modules'] }, () => {
    expect(integrationFromNamespace({ default: fakeIntegration })).toBe(fakeIntegration);
    // `module.exports = { default: integration }`, imported from ESM.
    expect(integrationFromNamespace({ default: { default: fakeIntegration } })).toBe(fakeIntegration);
    expect(integrationFromNamespace(undefined)).toBeUndefined();
  });
});
