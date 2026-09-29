import { test, expect } from '@playwright/test';
import {
  AssignConfigError,
  buildAssignConfig,
  diffAssignConfig,
  engineCvars,
  generateMatchPassword,
  rulesFromMatchConfig,
} from '../../api/src/integrations/cs2/fleet/assignConfig';
import { validatePayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';
import type { MatchConfig } from '../../api/src/types/match.types';

/**
 * The fleet driver's `match.assign.config` (fleet/assignConfig.ts): the
 * Auto Tournament CS2 match config as Ready Up's typed config (FLEET.md §7.1,
 * match.defs.json). Pure: no API, no database.
 *
 * @tag api
 */

const STEAM = (n: number) => `765611980000${String(n).padStart(5, '0')}`;

function tournamentConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    matchid: 42,
    skip_veto: true,
    num_maps: 3,
    players_per_team: 5,
    min_players_to_ready: 4,
    maplist: ['de_mirage', 'de_inferno', 'de_nuke'],
    map_sides: ['team1_ct', 'team2_ct', 'knife'],
    maxRounds: 24,
    overtimeMode: 'enabled',
    overtimeSegments: 0,
    team1: {
      id: 'team-a',
      name: 'Alpha',
      tag: 'ALPHA',
      players: { [STEAM(1)]: 'alice', [STEAM(2)]: 'bob', BOT: 'not a steam id' },
      coaches: { [STEAM(9)]: 'coach' },
    },
    team2: { id: 'team-b', name: 'Bravo', players: { [STEAM(3)]: 'carol' } },
    spectators: { players: { [STEAM(7)]: 'caster' } },
    admins: [STEAM(8), STEAM(8), 'nope'],
    cvars: {
      mp_maxrounds: 24,
      sv_password: 'leak',
      sv_cheats: 1,
      tv_delay: 90,
      at_autoready_enabled: 0,
      at_both_teams_unpause_required: 1,
      at_max_pauses_per_team: 0,
      at_pause_duration: 0,
      at_side_selection_enabled: 1,
      at_side_selection_time: 60,
      at_gg_enabled: 1,
      at_gg_threshold: 0.8,
      at_gg_min_score_diff: 8,
      at_ffw_enabled: 1,
      at_ffw_time: 240,
      at_demo_recording_enabled: 1,
      get5_check_auths: 'true',
    },
    ...over,
  };
}

test.describe('Fleet match.assign config', () => {
  test('a tournament match maps onto a schema-valid config', () => {
    const config = buildAssignConfig(tournamentConfig(), 'Pw7kQ2mZ9x', { allowForceReady: true, pauseAfterRestore: true });

    expect(config.num_maps).toBe(3);
    expect(config.maps).toEqual([
      { number: 1, name: 'de_mirage', sides: 'team1_ct' },
      { number: 2, name: 'de_inferno', sides: 'team2_ct' },
      { number: 3, name: 'de_nuke', sides: 'knife' },
    ]);
    expect(config.team1).toEqual({
      id: 'team-a',
      name: 'Alpha',
      tag: 'ALPHA',
      players: [
        { steamid64: STEAM(1), name: 'alice', role: 'player' },
        { steamid64: STEAM(2), name: 'bob', role: 'player' },
        { steamid64: STEAM(9), name: 'coach', role: 'coach' },
      ],
    });
    expect(config.team2.players).toEqual([{ steamid64: STEAM(3), name: 'carol', role: 'player' }]);
    expect(config.spectators).toEqual([STEAM(7)]);
    expect(config.admins).toEqual([STEAM(8)]);
    expect(config.password).toBe('Pw7kQ2mZ9x');
    // Engine cvars only; the at_* ones became rules, sv_password / sv_cheats never go.
    expect(config.cvars).toEqual({ mp_maxrounds: 24, tv_delay: 90 });

    const payload = { match_id: 'r1m1', epoch: 1, config_rev: 1, config };
    expect(validatePayload('match.assign', payload)).toEqual({ ok: true, errors: [] });
  });

  test('rules replace maxRounds, overtime and the at_* cvars', () => {
    expect(rulesFromMatchConfig(tournamentConfig(), { allowForceReady: false, pauseAfterRestore: true })).toEqual({
      max_rounds: 24,
      overtime: { enabled: true, max_overtimes: -1 },
      ready: { min_per_team: 4, allow_force_ready: false, autoready: false },
      knife: { side_pick_seconds: 60 },
      pause: { unpause: 'both_teams', pause_after_restore: true },
      whitelist: true,
      forfeit: { team_absent_seconds: 240, gg_vote: { enabled: true, threshold: 0.8, min_score_diff: 8 } },
      demo: { record: true, upload: false },
    });

    const off = rulesFromMatchConfig(
      tournamentConfig({
        overtimeMode: 'disabled',
        simulation: true,
        simulation_timescale: 4,
        wingman: true,
        cvars: {
          at_ffw_enabled: 0,
          at_demo_recording_enabled: 0,
          at_max_pauses_per_team: 3,
          at_pause_duration: 45,
          at_side_selection_time: 900,
        },
      })
    );
    expect(off.overtime).toEqual({ enabled: false });
    expect(off.forfeit).toEqual({ team_absent_seconds: 0 });
    expect(off.demo).toEqual({ record: false, upload: false });
    expect(off.pause).toEqual({ tactical_per_team: 3, tactical_seconds: 45 });
    expect(off.knife).toEqual({ side_pick_seconds: 300 });
    expect(off.wingman).toBe(true);
    expect(off.simulation).toEqual({ timescale: 4 });
    // A server that streams demos (demo.stream.v1) uploads what it records.
    expect(rulesFromMatchConfig(tournamentConfig(), { demoUpload: true }).demo).toEqual({ record: true, upload: true });
    expect(
      rulesFromMatchConfig(tournamentConfig({ cvars: { at_demo_recording_enabled: 0 } }), { demoUpload: true }).demo
    ).toEqual({ record: false, upload: false });
    expect(rulesFromMatchConfig(tournamentConfig({ overtimeSegments: 2 })).overtime).toEqual({
      enabled: true,
      max_overtimes: 2,
    });
  });

  test('a standalone match: fallback names, missing sides are knife', () => {
    const config = buildAssignConfig(
      {
        matchid: 7,
        skip_veto: true,
        num_maps: 1,
        players_per_team: 5,
        maplist: ['workshop/3084291314/aim_map'],
        team1: { name: '', players: {} },
        team2: { name: 'Mix', players: { [STEAM(4)]: '' } },
      },
      'abcDEF2345'
    );
    expect(config.maps).toEqual([{ number: 1, name: 'workshop/3084291314/aim_map', sides: 'knife' }]);
    expect(config.team1).toEqual({ name: 'Team 1', players: [] });
    expect(config.team2.players).toEqual([{ steamid64: STEAM(4), name: STEAM(4), role: 'player' }]);
    expect(config.cvars).toBeUndefined();
    expect(validatePayload('match.assign', { match_id: 'manual-1', epoch: 2, config })).toEqual({
      ok: true,
      errors: [],
    });
  });

  test('a match that cannot be played yet is refused before it is sent', () => {
    expect(() => buildAssignConfig(tournamentConfig({ maplist: null }), 'x')).toThrow(AssignConfigError);
    expect(() => buildAssignConfig(tournamentConfig({ maplist: ['de_mirage'] }), 'x')).toThrow(
      /needs 3 maps and has 1/
    );
    expect(() => buildAssignConfig(tournamentConfig({ num_maps: 1, maplist: ['de mirage'] }), 'x')).toThrow(
      /cannot be sent/
    );
  });

  test('engine cvars: mp_/sv_/tv_/bot_ only, never the password or cheats', () => {
    expect(
      engineCvars({
        mp_freezetime: 15,
        bot_quota: 0,
        sv_password: 'x',
        sv_setsteamaccount: 'y',
        ru_anything: 1,
        at_gg_enabled: 1,
        tv_enable: 1,
      })
    ).toEqual({ mp_freezetime: 15, bot_quota: 0, tv_enable: 1 });
    expect(engineCvars({ at_gg_enabled: 1 })).toBeUndefined();
    expect(engineCvars(undefined)).toBeUndefined();
  });

  test('connect passwords: 10 characters the schema accepts, different each time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pw = generateMatchPassword();
      expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
      expect(pw).toMatch(/^[!#-&(-:<-[\]-~]*$/);
      seen.add(pw);
    }
    expect(seen.size).toBe(50);
    // Deterministic with an injected source; bytes past the alphabet are skipped.
    const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => (i === 0 ? 255 : i)));
    expect(generateMatchPassword(bytes, 4)).toBe('BCDE');
  });

  test('roster diff: renames, players in and out, a moved player is removed then added', () => {
    const from = buildAssignConfig(tournamentConfig(), 'pw');
    const to = buildAssignConfig(
      tournamentConfig({
        team1: {
          id: 'team-a',
          name: 'Alpha Renamed',
          players: { [STEAM(1)]: 'alice' },
        },
        team2: { id: 'team-b', name: 'Bravo', players: { [STEAM(3)]: 'carol', [STEAM(2)]: 'bob' } },
        spectators: { players: { [STEAM(7)]: 'caster', [STEAM(6)]: 'observer' } },
      }),
      'pw'
    );
    expect(diffAssignConfig(from, to)).toEqual([
      { op: 'rename_team', team: 'team1', name: 'Alpha Renamed' },
      { op: 'remove_player', steamid64: STEAM(2) },
      { op: 'remove_player', steamid64: STEAM(9) },
      { op: 'add_player', team: 'team2', steamid64: STEAM(2), name: 'bob', role: 'player' },
      { op: 'add_player', team: 'spectator', steamid64: STEAM(6), name: STEAM(6) },
    ]);
    expect(diffAssignConfig(from, from)).toEqual([]);
    const update = {
      match_id: 'r1m1',
      epoch: 1,
      base_config_rev: 1,
      config_rev: 2,
      ops: diffAssignConfig(from, to),
    };
    expect(validatePayload('match.update', update)).toEqual({ ok: true, errors: [] });
  });

  test('substitutes keep role sub; a player made a sub (or back) is removed, then added with the role', () => {
    const base = tournamentConfig();
    const withSub = tournamentConfig({
      team1: {
        ...base.team1,
        players: { ...base.team1.players, [STEAM(4)]: 'dave' },
        substitutes: { [STEAM(4)]: 'dave' },
      },
    });
    const config = buildAssignConfig(withSub, 'pw');
    expect(config.team1.players).toContainEqual({ steamid64: STEAM(4), name: 'dave', role: 'sub' });
    expect(config.team1.players).toContainEqual({ steamid64: STEAM(1), name: 'alice', role: 'player' });
    // Listed only as a substitute: still on the roster, as a sub.
    const subOnly = buildAssignConfig(
      tournamentConfig({ team2: { ...base.team2, substitutes: { [STEAM(5)]: 'erin' } } }),
      'pw'
    );
    expect(subOnly.team2.players).toContainEqual({ steamid64: STEAM(5), name: 'erin', role: 'sub' });

    const asPlayer = buildAssignConfig(
      tournamentConfig({ team1: { ...base.team1, players: { ...base.team1.players, [STEAM(4)]: 'dave' } } }),
      'pw'
    );
    expect(diffAssignConfig(asPlayer, config)).toEqual([
      { op: 'remove_player', steamid64: STEAM(4) },
      { op: 'add_player', team: 'team1', steamid64: STEAM(4), name: 'dave', role: 'sub' },
    ]);
    expect(diffAssignConfig(config, asPlayer)).toEqual([
      { op: 'remove_player', steamid64: STEAM(4) },
      { op: 'add_player', team: 'team1', steamid64: STEAM(4), name: 'dave', role: 'player' },
    ]);
    expect(diffAssignConfig(config, config)).toEqual([]);
  });
});
