import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  BUILTIN_GAME_IDENTITIES,
  BUILTIN_WIKIDATA_QIDS,
  builtinSlugForWikidataId,
  pinnedWikidataId,
} from '../../api/src/services/builtinGameIdentity';
import { POPULAR_GAMES } from '../../api/src/services/gameCatalogService';
import { resetMismatchedBuiltinGames } from '../../api/src/config/schemaMigrations';

/**
 * Which game each built-in is: its pinned Wikidata item.
 *
 * Plenty of games share a name, and a built-in's picture, year and genres
 * come from Wikidata — so every built-in is pinned to one item, checked by
 * hand (label, developer, year), and nothing about a built-in is ever looked
 * up by name. This spec keeps the pins complete and pins the ones that went
 * wrong: the Deadlock card showed a 2016 "Deadlock", not Valve's.
 *
 * Pure: no server, no database.
 *
 * @tag api
 * @tag games
 */

const BUNDLED_INDEX = path.join(__dirname, '../../api/bundled-packs/index.json');
const CS2_MODULE = path.join(__dirname, '../../api/src/integrations/cs2/index.ts');

function bundledPacks(): Array<{ slug: string; name: string }> {
  return (JSON.parse(fs.readFileSync(BUNDLED_INDEX, 'utf8')) as { packs: Array<{ slug: string; name: string }> })
    .packs;
}

/** Lowercase letters and digits only, as the catalogue compares names. */
function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

test.describe('Built-in game identity', () => {
  test('every game the image ships is pinned to a Wikidata item', { tag: ['@api', '@games'] }, () => {
    const cs2Slug = /catalog:\s*{\s*slug:\s*'([^']+)'/.exec(fs.readFileSync(CS2_MODULE, 'utf8'))?.[1];
    expect(cs2Slug).toBe('counter-strike-2');

    const slugs = new Set([
      cs2Slug!,
      ...bundledPacks().map((p) => p.slug),
      ...POPULAR_GAMES.map((g) => g.slug),
    ]);
    const unpinned = [...slugs].filter((slug) => !pinnedWikidataId(slug));
    expect(unpinned, 'built-ins with no pinned Wikidata item').toEqual([]);

    // And nothing pinned that the image does not ship.
    expect(Object.keys(BUILTIN_WIKIDATA_QIDS).filter((slug) => !slugs.has(slug))).toEqual([]);
  });

  test('pins are well formed, one game per item', { tag: ['@api', '@games'] }, () => {
    const qids = Object.values(BUILTIN_WIKIDATA_QIDS);
    for (const qid of qids) expect(qid).toMatch(/^Q[1-9]\d*$/);
    expect(new Set(qids).size).toBe(qids.length);
    for (const [slug, qid] of Object.entries(BUILTIN_WIKIDATA_QIDS)) {
      expect(builtinSlugForWikidataId(qid)).toBe(slug);
    }
    expect(builtinSlugForWikidataId('Q990016')).toBeNull();
  });

  test("each pinned item's label names the built-in's game", { tag: ['@api', '@games'] }, () => {
    const names = new Map([
      ...POPULAR_GAMES.map((g) => [g.slug, g.name] as const),
      ...bundledPacks().map((p) => [p.slug, p.name] as const),
      ['counter-strike-2', 'Counter-Strike 2'] as const,
    ]);
    for (const [slug, identity] of Object.entries(BUILTIN_GAME_IDENTITIES)) {
      const name = key(names.get(slug) ?? slug);
      const label = key(identity.label);
      // "Rainbow Six Siege" is "Tom Clancy's Rainbow Six Siege" on Wikidata
      // and "Overwatch 2" is labelled "Overwatch" there now.
      expect(label.includes(name) || name.includes(label), `${slug}: ${identity.label}`).toBe(true);
    }
  });

  test('the games a same-named item was mistaken for', { tag: ['@api', '@games'] }, () => {
    // Valve's 2024 hero shooter, not the 2016 game called Deadlock.
    expect(BUILTIN_GAME_IDENTITIES.deadlock).toMatchObject({
      wikidataId: 'Q126042383',
      developer: 'Valve',
      year: 2024,
    });
    // The 2020 Trackmania, not the 2003 TrackMania.
    expect(BUILTIN_GAME_IDENTITIES.trackmania).toMatchObject({ wikidataId: 'Q91573142', year: 2020 });
    // The series the pack reports, not the 2003 game.
    expect(pinnedWikidataId('call-of-duty')).toBe('Q192156');
    // The board game.
    expect(pinnedWikidataId('chess')).toBe('Q718');
    expect(BUILTIN_GAME_IDENTITIES['counter-strike-2']).toMatchObject({
      wikidataId: 'Q111165107',
      developer: 'Valve',
      year: 2023,
    });
  });

  test('the data fix resets rows that hold another item, by pin', { tag: ['@api', '@games'] }, async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rowCount: 1 };
      },
    };
    const reset = await resetMismatchedBuiltinGames(client as never);
    expect(reset).toBe(1);
    expect(calls).toHaveLength(1);
    const [slugs, qids] = calls[0].params as [string[], string[]];
    expect(qids[slugs.indexOf('deadlock')]).toBe('Q126042383');
    expect(slugs).toHaveLength(Object.keys(BUILTIN_WIKIDATA_QIDS).length);
    // Only a row holding a *different* item is touched, and it forgets it.
    expect(calls[0].sql).toMatch(/g\.wikidata_id IS NOT NULL AND g\.wikidata_id <> pin\.qid/);
    expect(calls[0].sql).toMatch(/wikidata_id = NULL, cover_url = NULL/);
  });
});
