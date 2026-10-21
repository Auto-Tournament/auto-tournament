import { test, expect } from '@playwright/test';
import { adminCallText } from '../../api/src/addons/discord/adminCallText';
import type { AdminCall } from '../../api/src/types/adminCall.types';

/**
 * A player's admin call, as the DM to an admin who is away says it.
 *
 * @tag api
 */
test('the admin DM says who called, what they said, where, and links the match and team', () => {
  const call = {
    player: { name: 'Two', teamName: 'Kestrel', team: 'team1' },
    message: 'server lagging',
    team1Name: 'Kestrel',
    team2Name: 'Halcyon',
    mapNumber: 1,
    serverName: 'cs-3',
    matchSlug: 'r1-m2',
  } as unknown as AdminCall;
  expect(adminCallText(call, 'https://example.com', '99')).toBe(
    [
      '**Two (Kestrel) is calling for an admin**',
      '"server lagging"',
      'Kestrel vs Halcyon · map 2 · cs-3',
      'Match: https://example.com/match/r1-m2',
      'Team channel: <#99>',
    ].join('\n')
  );
  const bare = { player: { name: null }, message: '', mapNumber: null } as unknown as AdminCall;
  expect(adminCallText(bare, null, null)).toBe('**A player is calling for an admin**');
});
