import { test, expect } from '@playwright/test';
import { parseAdminSteamIds } from '../../api/src/utils/adminSteamIds';

/**
 * Parsing ADMIN_STEAM_IDS.
 *
 * The seeding itself runs at startup against the real database, so it cannot
 * be driven from here — but the parsing is where this can quietly go wrong. A
 * typo'd ID that is silently accepted would create a junk player row and grant
 * admin to nobody, which is worse than refusing it out loud.
 *
 * @tag api
 * @tag auth
 */
test.describe('ADMIN_STEAM_IDS parsing', () => {
  test('accepts a list and rejects anything that is not a Steam64 ID', () => {
    const { valid, invalid } = parseAdminSteamIds(
      '76561198000000001, 76561198000000002 76561198000000003;not-an-id 123'
    );

    expect(valid).toEqual([
      '76561198000000001',
      '76561198000000002',
      '76561198000000003',
    ]);
    // Refused loudly rather than turned into a junk player row.
    expect(invalid).toEqual(['not-an-id', '123']);
  });

  test('de-duplicates, so a repeated ID is not promoted twice', () => {
    const { valid } = parseAdminSteamIds('76561198000000001 76561198000000001');
    expect(valid).toEqual(['76561198000000001']);
  });

  test('treats unset and empty as "nothing to do", not as an error', () => {
    expect(parseAdminSteamIds(undefined)).toEqual({ valid: [], invalid: [] });
    expect(parseAdminSteamIds('   ')).toEqual({ valid: [], invalid: [] });
  });
});
