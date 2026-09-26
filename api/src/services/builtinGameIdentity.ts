/**
 * Which game each built-in *is*: its Wikidata item, pinned by hand.
 *
 * Plenty of games share a name. "Deadlock" is Valve's 2024 hero shooter and
 * several older games; "Trackmania" is the 2020 game and the 2003 one;
 * "Call of Duty" is a series and its 2003 first game. A built-in's picture,
 * year and genres must come from the right one, so nothing about a built-in
 * is ever looked up by name:
 *
 * - built-in enrichment (`gameEnrichmentService`) fetches exactly these items;
 * - a Wikidata search result (`gameCatalogService.searchGames`) that slugifies
 *   to a built-in's slug only updates the built-in's row when it *is* this
 *   item — a same-named game gets a row of its own — and a result that is
 *   this item updates the built-in's row whatever its label slugifies to;
 * - a stored row whose `wikidata_id` disagrees with its pin (a search before
 *   this guard existed filled it with a same-named game) is reset and
 *   re-enriched (the `2026-09-25-builtin-game-identity` migration, and
 *   `enrichBuiltinGames` on every start).
 *
 * Every entry was checked against its Wikidata item: the English label, the
 * developer and the year below. Covers every game the image ships (bundled
 * packs, `api/bundled-packs/index.json`), every popular title in
 * `gameCatalogService` and the CS2 module's own game;
 * `tests/api/builtin-game-identity.spec.ts` keeps it that way.
 *
 * `chess` is the board game (Q718), which is what the pack runs; its P31 is
 * not "video game" on purpose. `call-of-duty` is the series (Q192156), since
 * the pack reports any Call of Duty, not the 2003 game.
 */

export interface BuiltinGameIdentity {
  /** The Wikidata item (QID). */
  wikidataId: string;
  /** Its English label on Wikidata, as checked. */
  label: string;
  /** Developer, as checked (documentation; not used at runtime). */
  developer: string;
  /** First release year, as checked (documentation; not used at runtime). */
  year: number;
}

export const BUILTIN_GAME_IDENTITIES: Readonly<Record<string, BuiltinGameIdentity>> = {
  'counter-strike-2': { wikidataId: 'Q111165107', label: 'Counter-Strike 2', developer: 'Valve', year: 2023 },
  'age-of-empires-ii': {
    wikidataId: 'Q34852',
    label: 'Age of Empires II: The Age of Kings',
    developer: 'Ensemble Studios',
    year: 1999,
  },
  'apex-legends': { wikidataId: 'Q61478103', label: 'Apex Legends', developer: 'Respawn Entertainment', year: 2019 },
  'battlefield-6': { wikidataId: 'Q132178505', label: 'Battlefield 6', developer: 'Battlefield Studios', year: 2025 },
  'brawl-stars': { wikidataId: 'Q30330493', label: 'Brawl Stars', developer: 'Supercell', year: 2018 },
  'call-of-duty': { wikidataId: 'Q192156', label: 'Call of Duty', developer: 'Activision (series)', year: 2003 },
  chess: { wikidataId: 'Q718', label: 'chess', developer: '(board game)', year: 1475 },
  'clash-royale': { wikidataId: 'Q22095476', label: 'Clash Royale', developer: 'Supercell', year: 2016 },
  deadlock: { wikidataId: 'Q126042383', label: 'Deadlock', developer: 'Valve', year: 2024 },
  'dota-2': { wikidataId: 'Q771541', label: 'Dota 2', developer: 'Valve', year: 2013 },
  'ea-sports-fc-25': { wikidataId: 'Q127162066', label: 'EA Sports FC 25', developer: 'EA Vancouver', year: 2024 },
  fortnite: { wikidataId: 'Q349375', label: 'Fortnite', developer: 'Epic Games', year: 2017 },
  'guilty-gear-strive': {
    wikidataId: 'Q85863730',
    label: 'Guilty Gear Strive',
    developer: 'Arc System Works',
    year: 2021,
  },
  'halo-infinite': { wikidataId: 'Q54913666', label: 'Halo Infinite', developer: '343 Industries', year: 2021 },
  hearthstone: { wikidataId: 'Q8262784', label: 'Hearthstone', developer: 'Blizzard Entertainment', year: 2014 },
  'league-of-legends': { wikidataId: 'Q223341', label: 'League of Legends', developer: 'Riot Games', year: 2009 },
  'mario-kart-8-deluxe': { wikidataId: 'Q28321447', label: 'Mario Kart 8 Deluxe', developer: 'Nintendo', year: 2017 },
  'marvel-rivals': { wikidataId: 'Q125175413', label: 'Marvel Rivals', developer: 'NetEase Games', year: 2024 },
  minecraft: { wikidataId: 'Q49740', label: 'Minecraft', developer: 'Mojang Studios', year: 2011 },
  'mobile-legends-bang-bang': {
    wikidataId: 'Q42548576',
    label: 'Mobile Legends: Bang Bang',
    developer: 'Moonton',
    year: 2016,
  },
  'mortal-kombat-1': {
    wikidataId: 'Q118374430',
    label: 'Mortal Kombat 1',
    developer: 'NetherRealm Studios',
    year: 2023,
  },
  osu: { wikidataId: 'Q307441', label: 'osu!', developer: 'ppy', year: 2007 },
  'overwatch-2': { wikidataId: 'Q73163646', label: 'Overwatch', developer: 'Blizzard Entertainment', year: 2022 },
  'pubg-battlegrounds': { wikidataId: 'Q28937399', label: 'PUBG: Battlegrounds', developer: 'PUBG Studios', year: 2017 },
  'rainbow-six-siege': {
    wikidataId: 'Q17183996',
    label: "Tom Clancy's Rainbow Six Siege",
    developer: 'Ubisoft Montreal',
    year: 2015,
  },
  'rocket-league': { wikidataId: 'Q20031743', label: 'Rocket League', developer: 'Psyonix', year: 2015 },
  'splatoon-3': { wikidataId: 'Q105552720', label: 'Splatoon 3', developer: 'Nintendo', year: 2022 },
  'starcraft-ii': {
    wikidataId: 'Q239288',
    label: 'StarCraft II: Wings of Liberty',
    developer: 'Blizzard Entertainment',
    year: 2010,
  },
  'street-fighter-6': { wikidataId: 'Q110999026', label: 'Street Fighter 6', developer: 'Capcom', year: 2023 },
  'super-smash-bros-ultimate': {
    wikidataId: 'Q54093632',
    label: 'Super Smash Bros. Ultimate',
    developer: 'Bandai Namco Studios / Sora Ltd.',
    year: 2018,
  },
  'team-fortress-2': { wikidataId: 'Q382108', label: 'Team Fortress 2', developer: 'Valve', year: 2007 },
  'teamfight-tactics': { wikidataId: 'Q67650639', label: 'Teamfight Tactics', developer: 'Riot Games', year: 2019 },
  'tekken-8': { wikidataId: 'Q105486599', label: 'Tekken 8', developer: 'Bandai Namco Studios', year: 2024 },
  trackmania: { wikidataId: 'Q91573142', label: 'Trackmania', developer: 'Ubisoft Nadeo', year: 2020 },
  valorant: { wikidataId: 'Q86919275', label: 'Valorant', developer: 'Riot Games', year: 2020 },
};

/** Built-in slug -> its pinned Wikidata QID. */
export const BUILTIN_WIKIDATA_QIDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(BUILTIN_GAME_IDENTITIES).map(([slug, identity]) => [slug, identity.wikidataId])
);

const slugByQid = new Map(Object.entries(BUILTIN_WIKIDATA_QIDS).map(([slug, qid]) => [qid, slug]));

/** The pinned QID for a built-in slug, or null when the slug is not pinned. */
export function pinnedWikidataId(slug: string): string | null {
  return BUILTIN_WIKIDATA_QIDS[slug] ?? null;
}

/** The built-in slug a Wikidata item is pinned to, or null. */
export function builtinSlugForWikidataId(qid: string): string | null {
  return slugByQid.get(qid) ?? null;
}

/**
 * The SET list that forgets everything a row learned from Wikidata (and the
 * Steam icon found through it), back to a freshly seeded built-in, so the
 * next enrichment fills it from its pinned item. For a row that held a
 * same-named game.
 */
export const FORGET_WIKIDATA_SET = `wikidata_id = NULL, cover_url = NULL, logo_url = NULL,
  release_year = NULL, genres = NULL, steam_app_id = NULL, icon_url = NULL,
  icon_source = NULL, icon_checked_at = NULL, enriched_at = NULL, source = 'builtin'`;
