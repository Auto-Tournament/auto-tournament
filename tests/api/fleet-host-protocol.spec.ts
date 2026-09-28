import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  HOST_COMMAND_TYPES,
  HOST_DISRUPTIVE_TYPES,
  HOST_MESSAGES,
  HOST_MESSAGE_SCHEMAS,
  validateHostEnrollRequest,
  validateHostEnrollResponse,
  validateHostEnvelope,
  validateHostMessage,
  validateHostPayload,
} from '../../api/src/integrations/cs2/fleet/protocol/host/v1';
import {
  issueHostToken,
  parseHostToken,
  parseServerToken,
  redactFleetSecrets,
  verifySecret,
} from '../../api/src/integrations/cs2/fleet/credentials';
import { commandTargets, indexFleetServers, joinInventory, newServersOf } from '../../api/src/integrations/cs2/fleet/hosts/join';
import { validateModuleMigrations } from '../../api/src/config/moduleMigrations';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';
import { envelope } from '../helpers/fleet';
import { inventory, inventoryServer } from '../helpers/fleetHost';

/**
 * The host channel contract (FLEET.md §18.2, D18) without a running API:
 * - every host schema file is JSON with a unique $id under host/v1, and each
 *   message type has one;
 * - well-formed examples of every §18.2 message pass, obvious mistakes fail;
 * - `rhs_` host tokens have the server-token format but never parse as one;
 * - the inventory ↔ Ready Up join (§18.3) and which servers a command touches;
 * - the 009 migration stays in CS2's namespace.
 *
 * @tag api
 */

const PROTOCOL_DIR = path.join(__dirname, '../../api/src/integrations/cs2/fleet/protocol/host/v1');

test.describe('Fleet host protocol v1', () => {
  test('every schema file is JSON with a unique $id under host/v1', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json')) files.push(full);
      }
    };
    walk(PROTOCOL_DIR);
    const ids = new Set<string>();
    for (const file of files) {
      const schema = JSON.parse(fs.readFileSync(file, 'utf8')) as { $id: string };
      expect(schema.$id.startsWith('https://auto-tournament.dev/fleet/host/v1/'), file).toBe(true);
      expect(ids.has(schema.$id), schema.$id).toBe(false);
      ids.add(schema.$id);
    }
    for (const type of Object.keys(HOST_MESSAGE_SCHEMAS)) {
      expect(fs.existsSync(path.join(PROTOCOL_DIR, 'messages', `${type}.json`)), type).toBe(true);
      expect(HOST_MESSAGES[type], type).toBeTruthy();
    }
  });

  test('every §18.2 message accepts a well-formed example', () => {
    const force = { by: '76561198000000001', reason: 'hung during a match' };
    const examples: Record<string, object> = {
      'host.servers.list': {},
      'server.start': { server: 'server-2', launch_mode: 'default' },
      'server.stop': { server: 'server-2', grace_s: 10, force },
      'server.restart': { server: 'server-2', reason: 'hung', force },
      'server.create': { count: 2, enroll: true, enroll_key: `rfk_abcdefghjkmn_${'A'.repeat(43)}`, expires_at: Date.now() + 60_000 },
      'server.remove': { server: 'server-4', keep_files: true },
      'server.set_launch_args': { server: 'server-1', args: ['+map', 'de_inferno', '-maxplayers', '12'] },
      'host.update_game': { servers: ['server-1', 'server-2'] },
      'host.update_plugins': { readyup: { version: '0.5.0', bundle: 'skins' }, force },
      'host.updates_hold': { mode: 'on' },
      'logs.tail': { server: 'server-1', source: 'console', lines: 200, follow: true, max_s: 300 },
      'logs.stop': { stream_id: '01J8ZQ4T8W6N3X0F2R5K7M9P1C' },
      'host.inventory': inventory('fh_x', [inventoryServer('server-1'), inventoryServer('server-2', { readyup: { installed: null, health: 'not_running' } })]),
      'host.health': { server: 'server-2', event: 'hung', detail: '/health timed out for 30 s' },
      'host.result': { status: 'rejected', error: { code: 'match_in_progress', message: 'server-2 is live' } },
      'host.progress': { ref: '01J8ZQ4T8W6N3X0F2R5K7M9P1C', step: 'steamcmd 42%', pct: 42 },
      'logs.chunk': { stream_id: '01J8ZQ4T8W6N3X0F2R5K7M9P1C', server: 'server-1', lines: ['hello'], eof: false },
      'auth.rotate': { token: `rhs_abcdefghjkmn_${'A'.repeat(43)}`, old_valid_until: Date.now() },
      'auth.rotated': {},
    };
    for (const type of HOST_COMMAND_TYPES) expect(examples[type], `example for ${type}`).toBeTruthy();
    for (const [type, payload] of Object.entries(examples)) {
      expect(validateHostMessage(envelope(type, payload, { seq: 1 })), type).toEqual({ ok: true, errors: [] });
    }
  });

  test('obvious mistakes are rejected', () => {
    expect(validateHostPayload('server.stop', {}).ok).toBe(false); // no server
    expect(validateHostPayload('server.stop', { server: '../etc' }).ok).toBe(false); // not a server-N name
    expect(validateHostPayload('server.restart', { server: 'server-1' }).ok).toBe(false); // no reason
    expect(validateHostPayload('server.create', { count: 1 }).ok).toBe(false); // enroll is required
    expect(validateHostPayload('server.create', { enroll: true, count: 99 }).ok).toBe(false);
    expect(validateHostPayload('server.stop', { server: 'server-1', force: { by: 'x' } }).ok).toBe(false); // force needs a reason
    expect(validateHostPayload('host.updates_hold', { mode: 'maybe' }).ok).toBe(false);
    expect(validateHostPayload('host.result', { status: 'expired' }).ok).toBe(false);
    expect(validateHostPayload('auth.rotate', { token: `rus_abcdefghjkmn_${'A'.repeat(43)}`, old_valid_until: 1 }).ok).toBe(false);
    expect(validateHostEnvelope({ v: 1, type: 'ping', id: 'nope', ts: 1, payload: {} }).ok).toBe(false);
  });

  test('disruptive commands are the ones §18.2 lists', () => {
    expect([...HOST_DISRUPTIVE_TYPES].sort()).toEqual(
      ['host.update_game', 'host.update_plugins', 'server.remove', 'server.restart', 'server.set_launch_args', 'server.stop'].sort()
    );
  });

  test('host enrollment bodies', () => {
    const base = { kind: 'host', machine_id: 'a'.repeat(32), hostname: 'box', os: 'Ubuntu 24.04', csm_version: '2.0.0' };
    expect(validateHostEnrollRequest({ ...base, code: 'RUE-AAAA-BBBB-CCCC-DDDD' }).ok).toBe(true);
    expect(validateHostEnrollRequest({ ...base, key: `rfk_abcdefghjkmn_${'A'.repeat(43)}` }).ok).toBe(true);
    expect(validateHostEnrollRequest(base).ok).toBe(false); // neither
    expect(validateHostEnrollRequest({ ...base, code: 'x', key: `rfk_abcdefghjkmn_${'A'.repeat(43)}` }).ok).toBe(false); // both
    expect(validateHostEnrollRequest({ ...base, code: 'x', machine_id: 'short' }).ok).toBe(false); // the hashed machine id is 32 hex
    expect(validateHostEnrollRequest({ ...base, code: 'x', kind: undefined }).ok).toBe(false); // kind is required
    const token = issueHostToken().value;
    expect(
      validateHostEnrollResponse({ success: true, host_id: 'fh_1', tenant_id: 'default', token, ws_url: 'wss://x/api/fleet/host', reenrolled: false }).ok
    ).toBe(true);
  });

  test('rhs_ host tokens: format, hash, and never a server token', () => {
    const issued = issueHostToken();
    expect(issued.value).toMatch(/^rhs_[0-9a-z]{12}_[A-Za-z0-9_-]{43}$/);
    const parsed = parseHostToken(issued.value);
    expect(parsed?.id).toBe(issued.id);
    expect(verifySecret(parsed!, issued.hash)).toBe(true);
    expect(parseServerToken(issued.value)).toBeNull();
    expect(parseHostToken(issued.value.replace(/^rhs_/, 'rus_'))).toBeNull();
    expect(redactFleetSecrets(`token ${issued.value} here`)).toBe('token rhs_[redacted] here');
  });

  test('inventory joins Ready Up servers on install_id, then server_id', () => {
    const index = indexFleetServers([
      { id: 'fs_a', name: 'A', status: 'enrolled', install_id: 'inst-a', availability: 'available', versions: '{"core":"0.5.0"}' },
      { id: 'fs_b', name: 'B', status: 'enrolled', install_id: 'inst-b', availability: 'busy', versions: null },
    ]);
    const joined = joinInventory(
      [
        inventoryServer('server-1', { readyup: { installed: '0.5.0', install_id: 'inst-a', health: 'ok', update_safe: true } }),
        inventoryServer('server-2', { readyup: { installed: '0.5.0', server_id: 'fs_b', health: 'ok' } }),
        inventoryServer('server-3', { readyup: { installed: '0.5.0', install_id: 'unknown', health: 'ok', update_safe: false } }),
      ],
      index,
      (id) => id === 'fs_a'
    );
    expect(joined[0].fleetServer).toMatchObject({ id: 'fs_a', online: true, readyUpVersion: '0.5.0' });
    expect(joined[0].matchInProgress).toBe(false);
    expect(joined[1].fleetServer).toMatchObject({ id: 'fs_b', online: false, availability: 'busy' });
    expect(joined[1].matchInProgress).toBe(true); // Ready Up busy
    expect(joined[2].fleetServer).toBeNull();
    expect(joined[2].matchInProgress).toBe(true); // update_safe false
  });

  test('command targets', () => {
    const inv = [{ name: 'server-1' }, { name: 'server-2' }];
    expect(commandTargets('server.stop', { server: 'server-2' }, inv)).toEqual(['server-2']);
    expect(commandTargets('host.update_game', { servers: ['server-1'] }, inv)).toEqual(['server-1']);
    expect(commandTargets('host.update_game', {}, inv)).toEqual(['server-1', 'server-2']);
    expect(commandTargets('host.updates_hold', { mode: 'on' }, inv)).toEqual([]);
  });

  test('the servers a server.create made', () => {
    expect(newServersOf('created server-3, server-4', ['server-1', 'server-2'], [])).toEqual(['server-3', 'server-4']);
    // Names already there do not count (csm may mention the source).
    expect(newServersOf('copied server-1 to server-3', ['server-1', 'server-2'], [])).toEqual(['server-3']);
    // No names in the output: the inventory tells.
    expect(newServersOf('done', ['server-1'], ['server-1', 'server-2'])).toEqual(['server-2']);
    expect(newServersOf(null, undefined, ['server-1'])).toEqual(['server-1']);
  });

  test('the 009 migration stays in the cs2 namespace and can run twice', () => {
    expect(validateModuleMigrations('cs2', CS2_MIGRATIONS, { installedModuleIds: ['cs2'] })).toBeNull();
    const m = CS2_MIGRATIONS.find((x) => x.id === '009-fleet-hosts');
    expect(m).toBeTruthy();
    for (const table of ['hosts', 'host_tokens', 'host_enrollment_codes', 'host_outbox', 'host_commands', 'host_events']) {
      expect(m!.up).toContain(`CREATE TABLE IF NOT EXISTS cs2_fleet_${table}`);
    }
    expect(m!.up).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(m!.up).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
  });
});
