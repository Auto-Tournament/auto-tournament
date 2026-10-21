import { test, expect } from '@playwright/test';
import { missingPermissions } from '../../api/src/addons/discord/permissions';

/**
 * Which permissions the Discord bot needs and lacks on its server.
 *
 * @tag api
 */
test('the bot names what it lacks; Administrator covers everything', () => {
  const all = String(
    (1n << 0n) |
      (1n << 4n) |
      (1n << 10n) |
      (1n << 11n) |
      (1n << 14n) |
      (1n << 20n) |
      (1n << 24n) |
      (1n << 28n)
  );
  const noInvite = String(BigInt(all) & ~1n);
  expect(missingPermissions('g', ['bot'], [{ id: 'bot', permissions: all }])).toEqual([]);
  expect(missingPermissions('g', ['bot'], [{ id: 'bot', permissions: noInvite }])).toEqual([
    'Create Invite',
  ]);
  // @everyone (the server's id) counts too.
  expect(
    missingPermissions(
      'g',
      ['bot'],
      [
        { id: 'bot', permissions: noInvite },
        { id: 'g', permissions: '1' },
      ]
    )
  ).toEqual([]);
  expect(missingPermissions('g', ['bot'], [{ id: 'bot', permissions: '8' }])).toEqual([]);
  expect(missingPermissions('g', [], [])).toHaveLength(8);
});
