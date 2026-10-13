import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as apiFuzzy from '../../api/src/utils/fuzzy';
import * as clientFuzzy from '../../client/src/search/fuzzy';
import {
  SITE_SEARCH_INDEX,
  searchSiteIndex,
  type SiteSearchEntry,
} from '../../client/src/search/siteIndex';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * The site search: one table of queries and what they must find, with typos,
 * synonyms, word order and diacritics, through the browser's index of pages
 * and actions (client/src/search/siteIndex.ts) and both copies of the fuzzy
 * matcher (api/src/utils/fuzzy.ts, client/src/search/fuzzy.ts); then the API
 * finding content the same way.
 *
 * @tag api
 * @tag search
 */

const TAGS = { tag: ['@api', '@search'] };

// --- titles as the page shows them ---------------------------------------

type Json = { [key: string]: Json | string };
const root = join(__dirname, '..', '..', 'client', 'src');
function merge(into: Json, from: Json): Json {
  for (const [k, v] of Object.entries(from)) {
    into[k] = typeof v === 'object' && typeof into[k] === 'object' ? merge(into[k] as Json, v) : v;
  }
  return into;
}
function load(lang: string): { core: Json; cs2: Json } {
  const dir = join(root, 'locales', lang, 'translation');
  const core: Json = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    merge(core, JSON.parse(readFileSync(join(dir, file), 'utf8')) as Json);
  }
  const cs2 = JSON.parse(
    readFileSync(join(root, 'integrations', 'cs2', 'locales', `${lang}.json`), 'utf8')
  ) as Json;
  return { core, cs2 };
}
function titleFn(lang: string) {
  const strings = load(lang);
  return (e: SiteSearchEntry) => {
    let node: Json | string | undefined = e.title.ns === 'cs2' ? strings.cs2 : strings.core;
    for (const part of e.title.key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    if (typeof node !== 'string') throw new Error(`no ${lang} string for ${e.title.key}`);
    return node;
  };
}
const en = titleFn('en');
const nb = titleFn('nb');

const ADMIN = { signedIn: true, admin: true, modules: new Set(['cs2']) };
const PLAYER = { signedIn: true, admin: false, modules: new Set(['cs2']) };
const ANON = { signedIn: false, admin: false, modules: new Set(['cs2']) };

const find = (q: string, viewer = ADMIN, title = en) =>
  searchSiteIndex(q, viewer, title, en).map((e) => e.key);

test.describe('site search: pages, tabs and actions', () => {
  test('every entry has its title in every language it is shown in', TAGS, () => {
    for (const entry of SITE_SEARCH_INDEX) {
      expect(en(entry), entry.key).toBeTruthy();
      expect(nb(entry), entry.key).toBeTruthy();
    }
  });

  // [query, viewer, the entry that must come first]
  const TABLE: Array<[string, typeof ADMIN, string]> = [
    // The report that started it: "redress" found nothing.
    ['redress', ADMIN, 'redrawOverlays'],
    ['redraw', ADMIN, 'redrawOverlays'],
    ['Redraw overlays', ADMIN, 'redrawOverlays'],
    ['redrw overlays', ADMIN, 'redrawOverlays'], // a typo
    ['overlays redraw', ADMIN, 'redrawOverlays'], // word order
    ['update recorders', ADMIN, 'recordersUpdateAll'],
    ['update all', ADMIN, 'recordersUpdateAll'],
    ['benchmark', ADMIN, 'recordersBenchmark'],
    ['benchmrak', ADMIN, 'recordersBenchmark'], // swapped letters
    ['bench', ADMIN, 'recordersBenchmark'], // a partial word
    ['recorders', ADMIN, 'recorders'],
    ['reocrders', ADMIN, 'recorders'],
    ['add recorder', ADMIN, 'recordersAdd'],
    ['csm', ADMIN, 'servers'],
    ['add machine', ADMIN, 'addMachine'],
    ['music', ADMIN, 'highlightsMusic'],
    ['killfeed', ADMIN, 'overlays'],
    ['smtp', ADMIN, 'settingsSite'],
    ['keycloak', ADMIN, 'settingsSignIn'],
    ['disputes', ADMIN, 'disputes'],
    ['inventory', PLAYER, 'inventory'],
    ['inventroy', PLAYER, 'inventory'],
    ['loadout', PLAYER, 'inventory'],
    ['drop chances', ANON, 'dropRates'],
    ['my match', PLAYER, 'matchNow'],
    ['wingman', ANON, 'play'],
    ['ledaerboards', ANON, 'leaderboards'],
  ];
  for (const [q, viewer, first] of TABLE) {
    test(`"${q}" finds ${first}`, TAGS, () => {
      expect(find(q, viewer)[0]).toBe(first);
    });
  }

  test('admin entries only for admins, player entries only when signed in', TAGS, () => {
    expect(find('redraw overlays', PLAYER)).toEqual([]);
    expect(find('servers', ANON)).not.toContain('servers');
    expect(find('inventory', ANON)).not.toContain('inventory');
    expect(find('inventory', ADMIN)).toContain('inventory');
  });

  test("a module's entries only while it is installed", TAGS, () => {
    expect(find('redraw', { ...ADMIN, modules: new Set() })).toEqual([]);
  });

  test("the viewer's language and English both find an entry", TAGS, () => {
    // Norwegian: "Opptakere" is Recorders.
    expect(find(nb(SITE_SEARCH_INDEX.find((e) => e.key === 'recorders')!), ADMIN, nb)[0]).toBe(
      'recorders'
    );
    expect(find('recorders', ADMIN, nb)[0]).toBe('recorders');
  });
});

test.describe('site search: the matcher', () => {
  // [query, text, matches]
  const CASES: Array<[string, string, boolean]> = [
    ['bjorn', 'Bjørn', true],
    ['sjoberg', 'Sjøberg', true],
    ['aeroe', 'Ærø', true],
    ['cafe', 'Café Crew', true],
    ['MÜLLER', 'muller', true],
    ['navi', 'Natus Vincere (NAVI)', true],
    ['vincere natus', 'Natus Vincere', true],
    ['vinsere', 'Natus Vincere', true],
    ['nat', 'Natus Vincere', true],
    ['xyz', 'Natus Vincere', false],
    ['natus xyz', 'Natus Vincere', false], // every word has to match
    ['ab', 'Abc', true], // short: a start of a word
    ['ac', 'Abc', false], // short: no typos
    ['team 2024', 'Team 2025', false], // digits: no typos
    ['team 2025', 'Team 2025', true],
    ['', 'anything', false],
  ];
  for (const [q, text, hit] of CASES) {
    test(`"${q}" ${hit ? 'matches' : 'does not match'} "${text}"`, TAGS, () => {
      expect(apiFuzzy.fuzzyScore(q, [text]) > 0).toBe(hit);
      expect(clientFuzzy.fuzzyScore(q, [text])).toBe(apiFuzzy.fuzzyScore(q, [text]));
    });
  }

  test('better matches rank first: exact, then the start, then a typo', TAGS, () => {
    const names = ['Mirage Masters', 'Mirage', 'Mirag3', 'Old Mirage Cup', 'Mirrage'];
    const ranked = apiFuzzy.fuzzyRank('mirage', names, (n) => [n]).map((r) => r.item);
    expect(ranked[0]).toBe('Mirage');
    expect(ranked.indexOf('Mirrage')).toBeGreaterThan(ranked.indexOf('Old Mirage Cup'));
    expect(ranked.indexOf('Mirag3')).toBeGreaterThan(ranked.indexOf('Old Mirage Cup'));
  });
});

test(
  'the API finds players and teams fuzzily: typos, diacritics, word order',
  TAGS,
  async ({ request, playwright, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    const stamp = String(Date.now()).slice(-7);
    // Letters only, so the typo rules apply (a word with digits must be exact).
    const word = `Kv${Array.from(stamp, (d) => 'abcdefghij'[Number(d)]).join('')}`;
    const id = `765611982${stamp}1`;
    expect(
      (
        await request.post('/api/players/import', {
          headers,
          data: [{ steamId: id, name: `Bjørn ${word}` }],
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await request.post('/api/teams?upsert=true', {
          headers,
          data: {
            id: `fuzzy-${stamp}`,
            name: `Søndre ${word} Ulver`,
            tag: 'SNU',
            players: [{ steamId: id, name: `Bjørn ${word}` }],
          },
        })
      ).ok()
    ).toBe(true);

    const anon = await playwright.request.newContext({ baseURL });
    const search = async (q: string) =>
      (await (await anon.get(`/api/search?q=${encodeURIComponent(q)}`)).json()) as {
        players: Array<{ id: string }>;
        teams: Array<{ id: string }>;
        modules: unknown[];
      };
    // The name with a typo in it (a swapped pair), its diacritics dropped, its words swapped.
    const typo = word.slice(0, 3) + word[4] + word[3] + word.slice(5);
    expect((await search(`bjorn ${word}`)).players.map((p) => p.id)).toContain(id);
    expect((await search(`${typo} bjørn`)).players.map((p) => p.id)).toContain(id);
    expect((await search(`ulver sondre ${word}`)).teams.map((t) => t.id)).toContain(
      `fuzzy-${stamp}`
    );
    expect((await search(`${typo}`)).teams.map((t) => t.id)).toContain(`fuzzy-${stamp}`);
    expect(Array.isArray((await search(word)).modules)).toBe(true);
    await anon.dispose();
  }
);
