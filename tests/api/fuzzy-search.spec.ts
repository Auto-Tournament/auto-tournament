import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fold, score, scoreFields } from '../../api/src/utils/fuzzy';

/** The fuzzy matching behind the search box (client/src/search/fuzzy.ts, api/src/utils/fuzzy.ts). */

const TAGS = { tag: ['@api'] };
const root = path.resolve(__dirname, '../..');

test('the browser and the API score the same way', TAGS, () => {
  const client = readFileSync(path.join(root, 'client/src/search/fuzzy.ts'), 'utf8');
  const api = readFileSync(path.join(root, 'api/src/utils/fuzzy.ts'), 'utf8');
  expect(api).toBe(client);
});

test('typos, prefixes and words inside a name match; nonsense does not', TAGS, () => {
  expect(fold('Sjøberg Æsir  Straße')).toBe('sjoberg aesir strasse');
  const cases: Array<[string, string, boolean]> = [
    ['redress', 'Highlights: redraw overlays redraw redress', true],
    ['leaderbaord', 'Leaderboards', true],
    ['leader', 'Leaderboards', true],
    ['board', 'Leaderboards', true],
    ['recordrs', 'Highlights: recorders', true],
    ['overlay redraw', 'Redraw overlays', true],
    ['keycloak', 'sign in openid keycloak', true],
    ['xyzzy', 'Leaderboards', false],
    ['ab', 'Leaderboards', false],
  ];
  for (const [q, text, hit] of cases) {
    expect(score(q, text) > 0, `${q} → ${text}`).toBe(hit);
  }
  // Exact beats a prefix beats a typo.
  expect(score('team', 'team')).toBeGreaterThan(score('team', 'teams'));
  expect(score('team', 'teams')).toBeGreaterThan(score('taem', 'teams'));
  // A title outranks the same word among keywords.
  const title = scoreFields('clips', [{ text: 'Clips', weight: 1 }]);
  const keyword = scoreFields('clips', [
    { text: 'Recorders', weight: 1 },
    { text: 'clips', weight: 0.85 },
  ]);
  expect(title).toBeGreaterThan(keyword);
});
