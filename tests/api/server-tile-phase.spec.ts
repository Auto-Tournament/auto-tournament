import { test, expect } from '@playwright/test';
import { toServerMatch } from '../../client/src/integrations/cs2/servers/fleet/serverMatchPhase';

/**
 * The Servers page's word for what a server's match is doing (#616): a match
 * without a veto (shuffle) never reads "Veto"; the server's own phase wins.
 *
 * @tag api
 * @tag servers
 */
const base = { slug: 's', team1: { name: 'A' }, team2: { name: 'B' } };

test.describe('Server tile phase', () => {
  test('a shuffle match being joined is warmup, not veto', { tag: ['@api', '@servers'] }, () => {
    expect(
      toServerMatch({ ...base, status: 'loaded', vetoCompleted: false, liveStatus: 'warmup' }).phase
    ).toBe('warmup');
    expect(toServerMatch({ ...base, status: 'ready', vetoCompleted: false }).phase).toBeNull();
  });

  test('a match still in its veto reads veto', { tag: ['@api', '@servers'] }, () => {
    expect(toServerMatch({ ...base, status: 'pending', vetoCompleted: false }).phase).toBe('veto');
    expect(
      toServerMatch({ ...base, status: 'loaded', vetoCompleted: true, liveStatus: 'live' }).phase
    ).toBe('live');
    expect(toServerMatch({ ...base, status: 'completed', liveStatus: 'postgame' }).phase).toBe(
      'post'
    );
  });
});
