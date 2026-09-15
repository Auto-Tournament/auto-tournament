import { test, expect } from '@playwright/test';
import {
  classifyClearQueuedReply,
  classifyLoadMatchReply,
  parseConVarReply,
} from '../../api/src/utils/matchzyServerReplies';
import {
  buildMatchConfigUrl,
  buildServerEventsUrl,
  checkConfigFetch,
  demoMatchIdFromHeader,
  isFromAssignedServer,
} from '../../api/src/utils/serverAttribution';

/**
 * Reading what MatchZy says back, and deciding which server/match a request
 * belongs to.
 *
 * Seen on real servers (MatchZy-Enhanced 1.4.24, MR4 BO3 simulation): the final
 * became ready while its server was in postgame. The plugin queued the load,
 * MAT waited 10s for a config fetch that only comes after the reset, gave the
 * match to a second server, and the first server played it too. Events from
 * both were applied to one match, and demos landed on the wrong match because
 * the upload URL had already moved on.
 *
 * CI has no CS2 server, so these pin the classification on the exact strings.
 *
 * @tag api
 * @tag regression
 */
test.describe('MatchZy replies and server attribution', () => {
  test('a queued load is recognised, not treated as a refusal', () => {
    const observed =
      '[MAT] [LoadMatchDataCommand] Current match 13 is finishing. Queued next match from URL: ' +
      'http://192.168.50.196:3069/api/matches/r2m1.json to load after reset.\n';
    expect(classifyLoadMatchReply(observed)).toBe('queued');
    expect(
      classifyLoadMatchReply(
        '[matchzy match load] Current match 13 is postgame. Queued next match from URL: http://x/api/matches/r2m1.json'
      )
    ).toBe('queued');
    // MatchZy-Enhanced#16 appends a machine-readable token.
    expect(
      classifyLoadMatchReply(
        '[LoadMatchDataCommand] Current match 13 is finishing. Queued next match r2m1 from URL: ' +
          'http://x/api/matches/r2m1.json?server_id=s_3&match_id=15 to load after reset. queued_match=r2m1'
      )
    ).toBe('queued');
    expect(classifyLoadMatchReply('queued_match=r2m1')).toBe('queued');
  });

  test('clearing a queued load: new plugin replies, and old plugins without the command', () => {
    expect(
      classifyClearQueuedReply('[MatchQueue] Cleared queued match r2m1; it will not be loaded. cleared_queued_match=r2m1')
    ).toBe('cleared');
    expect(
      classifyClearQueuedReply('[MatchQueue] No queued match to clear. cleared_queued_match=none')
    ).toBe('none');
    expect(classifyClearQueuedReply('Unknown command "matchzy_clear_queued_match"!')).toBe('unsupported');
    expect(classifyClearQueuedReply('')).toBe('unsupported');
  });

  test('known refusals keep their classification', () => {
    expect(classifyLoadMatchReply('GOTV[0] not active')).toBe('gotv_inactive');
    expect(
      classifyLoadMatchReply('A match is already setup with id: 13, cannot load a new match!')
    ).toBe('already_setup');
    expect(classifyLoadMatchReply('Match load failed! Resetting current match')).toBe('failed');
    expect(classifyLoadMatchReply('')).toBe('unknown');
    expect(classifyLoadMatchReply(undefined)).toBe('unknown');
    expect(classifyLoadMatchReply('Match setup request received')).toBe('unknown');
  });

  test('convar replies parse in the unquoted FakeConVar form and the quoted form', () => {
    // CounterStrikeSharp FakeConVar: `{name} = {value}`. The old quoted-only
    // pattern read this as "no status", which defaulted to idle.
    expect(parseConVarReply('matchzy_tournament_status = postgame', 'matchzy_tournament_status')).toBe(
      'postgame'
    );
    expect(parseConVarReply('matchzy_tournament_updated = 1789509788\n')).toBe('1789509788');
    expect(parseConVarReply('matchzy_tournament_next_match = ', 'matchzy_tournament_next_match')).toBe('');
    expect(parseConVarReply('"matchzy_tournament_status" = "idle" ( def. "idle" )')).toBe('idle');
    expect(parseConVarReply('mp_maxrounds = 24 ( def. "24" )', 'mp_maxrounds')).toBe('24');
    expect(parseConVarReply('Unknown command "matchzy_tournament_status"!')).toBeNull();
    expect(parseConVarReply('other_var = 1', 'matchzy_tournament_status')).toBeNull();
    expect(parseConVarReply(undefined)).toBeNull();
  });

  test('URLs carry the server and match identity, and stay plain without it', () => {
    expect(buildServerEventsUrl('http://mat:3069', 's_3')).toBe(
      'http://mat:3069/api/events?server_id=s_3'
    );
    expect(buildServerEventsUrl('http://mat:3069', null)).toBe('http://mat:3069/api/events');
    expect(buildMatchConfigUrl('http://mat:3069', 'r2m1', 's_3', 15)).toBe(
      'http://mat:3069/api/matches/r2m1.json?server_id=s_3&match_id=15'
    );
    expect(buildMatchConfigUrl('http://mat:3069', 'r2m1')).toBe(
      'http://mat:3069/api/matches/r2m1.json'
    );
  });

  test('events are applied only from the assigned server when both are known', () => {
    expect(isFromAssignedServer('s_2', 's_2')).toBe(true);
    expect(isFromAssignedServer('s_2', 's_3')).toBe(false);
    // Legacy servers (no identity) and unassigned matches keep working.
    expect(isFromAssignedServer('s_2', null)).toBe(true);
    expect(isFromAssignedServer(null, 's_3')).toBe(true);
  });

  test('a queued config fetch is refused once the match moved or the slug was reused', () => {
    const match = { id: 15, server_id: 's_2' };
    expect(checkConfigFetch(match, 's_2', '15').ok).toBe(true);
    expect(checkConfigFetch(match, null, null).ok).toBe(true);
    // The first server acting on its queued load after re-allocation.
    expect(checkConfigFetch(match, 's_3', '15').ok).toBe(false);
    // A load queued before a tournament reset: same slug, new match row.
    expect(checkConfigFetch(match, 's_2', '9').ok).toBe(false);
    expect(checkConfigFetch({ id: 15, server_id: null }, 's_3', '15').ok).toBe(false);
  });

  test('demo match id header: numeric ids decide, anything else falls back to the URL', () => {
    expect(demoMatchIdFromHeader('13')).toBe(13);
    expect(demoMatchIdFromHeader(' 15 ')).toBe(15);
    expect(demoMatchIdFromHeader('0')).toBeNull();
    expect(demoMatchIdFromHeader('r1m1')).toBeNull();
    expect(demoMatchIdFromHeader('')).toBeNull();
    expect(demoMatchIdFromHeader(undefined)).toBeNull();
  });
});
