import { test, expect } from '@playwright/test';
import {
  adminListHash,
  adminsHelloAction,
  buildAdminList,
  MAX_FLEET_ADMINS,
} from '../../api/src/integrations/cs2/fleet/push/admins';
import {
  buildServerConfigPayload,
  buildSettingsSetCmd,
  keepStatusToken,
  mergeSettings,
  redactSettings,
  settingsHelloNeeded,
  validateSettings,
  type FleetSettings,
} from '../../api/src/integrations/cs2/fleet/push/settings';
import {
  validatePlugins,
  validateWhitelist,
} from '../../api/src/integrations/cs2/fleet/push/controls';
import {
  applyOpsToAssignConfig,
  applyOpsToMatchConfig,
  rosterView,
  validateRosterOps,
} from '../../api/src/integrations/cs2/fleet/push/matchUpdate';
import type { ServerPrefs } from '../../api/src/integrations/cs2/fleet/push/store';
import { buildAssignConfig } from '../../api/src/integrations/cs2/fleet/assignConfig';
import type { MatchConfig } from '../../api/src/types/match.types';
import { validatePayload, type MatchState } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The pure parts of the server-level pushes (FLEET.md §7.3-§7.5): the
 * admins.set list and its rev decision after a hello, settings validation /
 * merge / payloads, the whitelist and plugins checks, and match.update ops
 * applied to the stored config. No server, no database.
 *
 * @tag api
 */

const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';

function prefs(pushed: ServerPrefs['pushed'] = {}): ServerPrefs {
  return {
    serverId: 'fs_x',
    settings: null,
    whitelist: null,
    practice: null,
    plugins: null,
    pushed,
    updatedBy: null,
    updatedAt: null,
  };
}

test.describe('fleet pushes: admins.set list', () => {
  test('platform admins and extras: Steam64 only, one each, sorted, platform names win', () => {
    const { admins, dropped } = buildAdminList(
      [
        { id: B, name: 'Bea' },
        { id: 'not-a-steam-id', name: 'SSO only' },
        { id: A, name: '  Ann\u0007 ' },
      ],
      [
        { steamid64: A, name: 'Ann (extra)' },
        { steamid64: C, name: '' },
        { steamid64: '123', name: 'short' },
      ]
    );
    expect(admins).toEqual([
      { steamid64: A, name: 'Ann' },
      { steamid64: B, name: 'Bea' },
      { steamid64: C, name: C },
    ]);
    expect(dropped).toBe(2);
    expect(validatePayload('admins.set', { rev: 1, admins }).ok).toBe(true);
  });

  test('capped at 1000, the rest counted as dropped', () => {
    const many = Array.from({ length: MAX_FLEET_ADMINS + 5 }, (_, i) => ({
      id: String(76561198000000000n + BigInt(i)),
      name: `p${i}`,
    }));
    const { admins, dropped } = buildAdminList(many);
    expect(admins).toHaveLength(MAX_FLEET_ADMINS);
    expect(dropped).toBe(5);
  });

  test('the hash follows the list, not the query order', () => {
    const one = buildAdminList([
      { id: A, name: 'Ann' },
      { id: B, name: 'Bea' },
    ]).admins;
    const two = buildAdminList([
      { id: B, name: 'Bea' },
      { id: A, name: 'Ann' },
    ]).admins;
    expect(adminListHash(one)).toBe(adminListHash(two));
    const renamed = buildAdminList([
      { id: A, name: 'Anna' },
      { id: B, name: 'Bea' },
    ]).admins;
    expect(adminListHash(renamed)).not.toBe(adminListHash(one));
  });

  test('after a hello: push when behind, skip when current or still queued, raise when ahead', () => {
    expect(
      adminsHelloAction({ platformRev: 3, helloRev: 3, lastPush: undefined, txAcked: 0 })
    ).toBe('skip');
    expect(
      adminsHelloAction({ platformRev: 3, helloRev: undefined, lastPush: undefined, txAcked: 0 })
    ).toBe('push');
    expect(
      adminsHelloAction({ platformRev: 3, helloRev: 2, lastPush: undefined, txAcked: 0 })
    ).toBe('push');
    // Rev 3 sits in the outbox at seq 7 and the server acked only 5: the replay delivers it.
    expect(
      adminsHelloAction({
        platformRev: 3,
        helloRev: 2,
        lastPush: { rev: 3, seq: 7, at: 1 },
        txAcked: 5,
      })
    ).toBe('skip');
    // Acked but the server reports 2 (it lost its cache): send again.
    expect(
      adminsHelloAction({
        platformRev: 3,
        helloRev: 2,
        lastPush: { rev: 3, seq: 7, at: 1 },
        txAcked: 7,
      })
    ).toBe('push');
    // The server has 9 from an earlier database: ours must go above it.
    expect(
      adminsHelloAction({ platformRev: 3, helloRev: 9, lastPush: undefined, txAcked: 0 })
    ).toBe('raise');
  });
});

test.describe('fleet pushes: settings', () => {
  test('validation: known fields with bounds; unknown names and bad values are errors', () => {
    const ok = validateSettings({
      config: {
        hostname_format: '{TEAM1} vs {TEAM2}',
        series_end_kick_delay: { no_demo: 5, demo_upload: 60 },
        scrim_knife: false,
        warmup: { money: 16000, message_html: '<b>hi</b>\nthere' },
      },
      match: { playout_enabled_default: true, minimum_ready_required: 4 },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.config.series_end_kick_delay).toEqual({ no_demo: 5, demo_upload: 60 });
      expect(ok.value.match).toEqual({ playout_enabled_default: true, minimum_ready_required: 4 });
    }

    const bad = validateSettings({
      config: {
        hostname_format: 5,
        nope: true,
        series_end_kick_delay: { no_demo: -1 },
        chat_prefix: 'a\u0001',
      },
      match: { minimum_ready_required: 99, knife_enabled_default: true },
      extra: {},
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual(
        expect.arrayContaining([
          'extra is not a settings group (config, match)',
          'config.hostname_format must be a string',
          'config.nope is not a setting',
          'config.series_end_kick_delay.no_demo must be 0-3600',
          'config.chat_prefix contains control characters',
          'match.minimum_ready_required must be 0-32',
          'match.knife_enabled_default is not a setting',
        ])
      );
    }
    // null / missing: nothing set.
    expect(validateSettings(null)).toEqual({ ok: true, value: { config: {}, match: {} } });
    expect(validateSettings({ config: { scrim_knife: null } })).toEqual({
      ok: true,
      value: { config: {}, match: {} },
    });
  });

  test('an override merges on top of the default, nested objects field by field', () => {
    const base: FleetSettings = {
      config: { chat_prefix: '[AT]', series_end_kick_delay: { no_demo: 5, demo_upload: 60 } },
      match: { playout_enabled_default: false, autoready_enabled: true },
    };
    const over: FleetSettings = {
      config: { series_end_kick_delay: { demo_upload: 90 }, hostname_format: 'X' },
      match: { playout_enabled_default: true },
    };
    expect(mergeSettings(base, over)).toEqual({
      config: {
        chat_prefix: '[AT]',
        series_end_kick_delay: { no_demo: 5, demo_upload: 90 },
        hostname_format: 'X',
      },
      match: { playout_enabled_default: true, autoready_enabled: true },
    });
    expect(mergeSettings(base, null)).toEqual(base);
  });

  test('payloads: server.config and cmd settings.set pass their schemas; nothing to send is null', () => {
    const s: FleetSettings = {
      config: { hostname_format: '{TEAM1} vs {TEAM2}', scrim_knife: true },
      match: { kick_when_no_match_loaded: true },
    };
    const cfg = buildServerConfigPayload(4, s);
    expect(cfg).toEqual({ rev: 4, settings: s.config });
    expect(validatePayload('server.config', cfg).ok).toBe(true);
    const cmd = buildSettingsSetCmd(s);
    expect(cmd).toMatchObject({
      name: 'settings.set',
      args: { settings: { kick_when_no_match_loaded: true } },
      expires_at: 0,
    });
    expect(validatePayload('cmd', cmd).ok).toBe(true);
    expect(buildServerConfigPayload(1, { config: {}, match: {} })).toBeNull();
    expect(buildSettingsSetCmd({ config: {}, match: {} })).toBeNull();
  });

  test('the status HTTP token is write-only: redacted in responses, kept by a save that omits it', () => {
    const stored: FleetSettings = {
      config: { status_http: { token: 's3cret' }, chat_prefix: 'x' },
      match: {},
    };
    const red = redactSettings(stored);
    expect(red.statusTokenSet).toBe(true);
    expect(JSON.stringify(red)).not.toContain('s3cret');
    expect(red.config.status_http).toBeUndefined();

    const kept = keepStatusToken({ config: { chat_prefix: 'y' }, match: {} }, stored);
    expect(kept.config.status_http?.token).toBe('s3cret');
    const replaced = keepStatusToken(
      { config: { status_http: { token: 'new' } }, match: {} },
      stored
    );
    expect(replaced.config.status_http?.token).toBe('new');
    const cleared = keepStatusToken({ config: { status_http: { token: '' } }, match: {} }, stored);
    expect(cleared.config.status_http).toBeUndefined();
  });

  test('a hello pushes the settings only when the server is behind the current rev', () => {
    const s: FleetSettings = { config: { scrim_knife: true }, match: { autoready_enabled: true } };
    expect(settingsHelloNeeded(3, s, prefs())).toBe(true);
    expect(
      settingsHelloNeeded(
        3,
        s,
        prefs({ server_config: { rev: 3, seq: 1, at: 1 }, settings: { rev: 3, id: 'x', at: 1 } })
      )
    ).toBe(false);
    expect(
      settingsHelloNeeded(
        4,
        s,
        prefs({ server_config: { rev: 3, seq: 1, at: 1 }, settings: { rev: 4, id: 'x', at: 1 } })
      )
    ).toBe(true);
    expect(settingsHelloNeeded(4, { config: {}, match: {} }, prefs())).toBe(false);
  });
});

test.describe('fleet pushes: whitelist, plugins', () => {
  test('whitelist: SteamID64 strings, de-duplicated, at most 1000', () => {
    expect(validateWhitelist({ enabled: true, steamids: [A, ` ${A} `, B] })).toEqual({
      ok: true,
      value: { enabled: true, steamids: [A, B] },
    });
    expect(validateWhitelist({ enabled: false })).toEqual({
      ok: true,
      value: { enabled: false, steamids: [] },
    });
    expect(validateWhitelist({ enabled: 'yes' }).ok).toBe(false);
    expect(validateWhitelist({ enabled: true, steamids: ['123'] }).ok).toBe(false);
    const many = Array.from({ length: 1001 }, (_, i) => String(76561198000000000n + BigInt(i)));
    expect(validateWhitelist({ enabled: true, steamids: many }).ok).toBe(false);
  });

  test('plugins: names, limits, and match / fleet stay loaded', () => {
    expect(validatePlugins({ enable: ['Practice', 'skins'], disable: ['midas'] })).toEqual({
      ok: true,
      value: { enable: ['practice', 'skins'], disable: ['midas'] },
    });
    expect(validatePlugins({ disable: ['fleet'] }).ok).toBe(false);
    expect(validatePlugins({ disable: ['match'] }).ok).toBe(false);
    expect(validatePlugins({ enable: ['bad name'] }).ok).toBe(false);
    expect(validatePlugins({ enable: ['a'], disable: ['a'] }).ok).toBe(false);
    expect(validatePlugins({}).ok).toBe(false);
    expect(validatePlugins({ enable: Array.from({ length: 17 }, (_, i) => `p${i}`) }).ok).toBe(
      false
    );
  });
});

test.describe('fleet pushes: match.update', () => {
  test('ops: add / remove / rename only, checked; a valid set passes the match.update schema', () => {
    const check = validateRosterOps([
      { op: 'remove_player', steamid64: A },
      { op: 'add_player', team: 'team1', steamid64: C, name: ' Cid ', role: 'sub' },
      { op: 'rename_team', team: 'team2', name: 'Blue' },
    ]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.ops[1]).toEqual({
      op: 'add_player',
      team: 'team1',
      steamid64: C,
      name: 'Cid',
      role: 'sub',
    });
    const payload = {
      match_id: 'm-1',
      epoch: 2,
      base_config_rev: 3,
      config_rev: 4,
      ops: check.ops,
    };
    expect(validatePayload('match.update', payload)).toEqual({ ok: true, errors: [] });

    expect(validateRosterOps([]).ok).toBe(false);
    expect(validateRosterOps([{ op: 'set_password', password: 'x' }]).ok).toBe(false);
    expect(
      validateRosterOps([{ op: 'add_player', team: 'team3', steamid64: C, name: 'x' }]).ok
    ).toBe(false);
    expect(
      validateRosterOps([{ op: 'add_player', team: 'team1', steamid64: '1', name: 'x' }]).ok
    ).toBe(false);
    expect(validateRosterOps([{ op: 'rename_team', team: 'spectator', name: 'x' }]).ok).toBe(false);
  });

  test('the stored config follows: substitute, move, spectator, rename', () => {
    const config = {
      matchid: 7,
      team1: { name: 'Red', players: { [A]: 'Ann', [B]: 'Bea' } },
      team2: { name: 'Blue', players: [{ steamid: C, name: 'Cid' }] },
    };
    const next = applyOpsToMatchConfig(config, [
      { op: 'remove_player', steamid64: B },
      { op: 'add_player', team: 'team1', steamid64: '76561198000000004', name: 'Dee' },
      { op: 'add_player', team: 'team2', steamid64: A, name: 'Ann' },
      { op: 'add_player', team: 'spectator', steamid64: '76561198000000005', name: 'Caster' },
      { op: 'rename_team', team: 'team2', name: 'Navy' },
    ]);
    expect(next.team1).toEqual({ name: 'Red', players: { '76561198000000004': 'Dee' } });
    expect(next.team2).toEqual({ name: 'Navy', players: { [C]: 'Cid', [A]: 'Ann' } });
    expect(next.spectators).toEqual({ players: { '76561198000000005': 'Caster' } });
    expect(next.matchid).toBe(7);
    // The input is not changed.
    expect(config.team1.players).toEqual({ [A]: 'Ann', [B]: 'Bea' });
  });

  test("the driver's acked assign config follows too (roles kept, spectators as ids)", () => {
    const acked = {
      num_maps: 1,
      maps: [{ number: 1, name: 'de_dust2', sides: 'knife' as const }],
      team1: {
        id: 't1',
        name: 'Red',
        players: [{ steamid64: A, name: 'Ann', role: 'player' as const }],
      },
      team2: {
        id: 't2',
        name: 'Blue',
        players: [{ steamid64: B, name: 'Bea', role: 'coach' as const }],
      },
      spectators: [C],
    };
    const next = applyOpsToAssignConfig(acked, [
      { op: 'remove_player', steamid64: A },
      { op: 'add_player', team: 'team1', steamid64: C, name: 'Cid', role: 'sub' },
      { op: 'add_player', team: 'spectator', steamid64: A, name: 'Ann' },
      { op: 'rename_team', team: 'team2', name: 'Navy' },
    ]);
    expect(next.team1.players).toEqual([{ steamid64: C, name: 'Cid', role: 'sub' }]);
    expect(next.team2).toMatchObject({
      name: 'Navy',
      players: [{ steamid64: B, name: 'Bea', role: 'coach' }],
    });
    expect(next.spectators).toEqual([A]);
    expect(acked.team1.players).toHaveLength(1);
  });

  test('roster view: the live state wins; the stored config without a snapshot', () => {
    const state = {
      teams: {
        team1: {
          name: 'Red',
          score: 0,
          players: { [A]: { name: 'Ann', role: 'player', connected: true, ready: true } },
        },
        team2: { name: 'Blue', score: 0, players: {} },
      },
      spectators: { [C]: { name: 'Cid', connected: false } },
    } as unknown as MatchState;
    const live = rosterView(state, null);
    expect(live.source).toBe('live');
    expect(live.team1.players).toEqual([
      { steamid64: A, name: 'Ann', role: 'player', connected: true },
    ]);
    expect(live.spectators).toEqual([{ steamid64: C, name: 'Cid', role: null, connected: false }]);

    const fromConfig = rosterView(null, { team1: { name: 'R', players: { [B]: 'Bea' } } });
    expect(fromConfig.source).toBe('config');
    expect(fromConfig.team1).toEqual({
      name: 'R',
      players: [{ steamid64: B, name: 'Bea', role: 'player', connected: null }],
    });
    expect(fromConfig.team2.players).toEqual([]);
  });

  test('a sub added by match.update stays a sub: stored config, roster view, the next assign', () => {
    // M1 play-test: the role was dropped, and the sub came back as a player.
    const config = {
      matchid: 7,
      team1: { name: 'Red', players: { [A]: 'Ann' } },
      team2: { name: 'Blue', players: { [B]: 'Bea' } },
    };
    const withSub = applyOpsToMatchConfig(config, [
      { op: 'add_player', team: 'team1', steamid64: C, name: 'Cid', role: 'sub' },
      { op: 'add_player', team: 'team2', steamid64: '76561198000000004', name: 'Coach', role: 'coach' },
    ]);
    expect(withSub.team1).toEqual({
      name: 'Red',
      players: { [A]: 'Ann', [C]: 'Cid' },
      substitutes: { [C]: 'Cid' },
    });
    // A coach is a coach, not a player.
    expect(withSub.team2).toEqual({
      name: 'Blue',
      players: { [B]: 'Bea' },
      coaches: { '76561198000000004': 'Coach' },
    });
    const view = rosterView(null, withSub);
    expect(view.team1.players).toEqual([
      { steamid64: A, name: 'Ann', role: 'player', connected: null },
      { steamid64: C, name: 'Cid', role: 'sub', connected: null },
    ]);
    expect(view.team2.players).toContainEqual({
      steamid64: '76561198000000004',
      name: 'Coach',
      role: 'coach',
      connected: null,
    });
    // What a failover re-assign builds from the stored config.
    const assign = buildAssignConfig(
      {
        ...withSub,
        skip_veto: true,
        num_maps: 1,
        players_per_team: 1,
        maplist: ['de_mirage'],
        map_sides: ['knife'],
      } as unknown as MatchConfig,
      'pw'
    );
    expect(assign.team1.players).toContainEqual({ steamid64: C, name: 'Cid', role: 'sub' });
    expect(assign.team2.players).toContainEqual({ steamid64: '76561198000000004', name: 'Coach', role: 'coach' });

    // Made a player again, then removed: nothing left behind.
    const promoted = applyOpsToMatchConfig(withSub, [
      { op: 'add_player', team: 'team1', steamid64: C, name: 'Cid', role: 'player' },
    ]);
    expect(promoted.team1).toEqual({ name: 'Red', players: { [A]: 'Ann', [C]: 'Cid' } });
    const removed = applyOpsToMatchConfig(withSub, [
      { op: 'remove_player', steamid64: C },
      { op: 'remove_player', steamid64: '76561198000000004' },
    ]);
    expect(removed.team1).toEqual({ name: 'Red', players: { [A]: 'Ann' } });
    expect(removed.team2).toEqual({ name: 'Blue', players: { [B]: 'Bea' }, coaches: {} });
  });
});
