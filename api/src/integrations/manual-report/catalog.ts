/**
 * The manual-report module's catalogue entries.
 *
 * The module is not a game: it is the way a result reaches MAT when the game
 * cannot send one itself. So it keeps out of the catalogue under its own name
 * (`catalog: null`) and instead ships the titles it comes ready to run, one
 * `games` row each, with itself as their integration. Those games then read as
 * supported, and a tournament can be created for them.
 *
 * The slugs are IGDB slugs, the same ones `gameCatalogService`'s popular list
 * uses, so an IGDB or Wikidata result for Rocket League enriches this row
 * rather than adding a second one. Titles already claimed by another module
 * (Counter-Strike 2) are deliberately absent: that game has a real
 * integration, and a module must not take another's rows.
 *
 * The list is not the limit of what the module runs. `runsAnyCatalogGame`
 * makes it the fallback for every other catalogue id, so a tournament for a
 * game someone found through IGDB search is reported manually too; these
 * entries are only the ones that exist without any search.
 *
 * `icon` is the module's own square tile, shipped in `client/public/games`.
 * Five titles have none yet — Overwatch 2, EA Sports FC, Super Smash Bros.
 * Ultimate, Street Fighter 6 and Tekken 8 — and the setup wizard shows their
 * text mark instead of borrowing art that is not theirs.
 */

import type { GameCatalogEntry } from '../types';

export const MANUAL_REPORT_GAME_ID = 'manual-report';

/**
 * How a tournament row names a manually reported game. `tournament.game` holds
 * a catalogue id from 3.0 phase D onwards ('rocket-league'), not an
 * integration id, because this module runs many games and the row has to say
 * which one. The module's own id stays valid as a `game` value (the registry
 * resolves an integration id first), and means "a game this instance has no
 * catalogue row for".
 */
export const MANUAL_REPORT_CATALOG: ReadonlyArray<GameCatalogEntry> = [
  {
    slug: 'rocket-league',
    name: 'Rocket League',
    aliases: ['rl'],
    icon: '/games/rocket-league.svg',
  },
  { slug: 'valorant', name: 'Valorant', icon: '/games/valorant.svg' },
  {
    slug: 'league-of-legends',
    name: 'League of Legends',
    aliases: ['lol'],
    icon: '/games/league-of-legends.svg',
  },
  { slug: 'dota-2', name: 'Dota 2', aliases: ['dota'], icon: '/games/dota-2.svg' },
  { slug: 'deadlock', name: 'Deadlock', icon: '/games/deadlock.svg' },
  { slug: 'overwatch-2', name: 'Overwatch 2', aliases: ['ow', 'ow2'] },
  { slug: 'battlefield-6', name: 'Battlefield 6', aliases: ['bf6', 'bf'], icon: '/games/battlefield-6.svg' },
  { slug: 'trackmania', name: 'Trackmania', aliases: ['tm'], icon: '/games/trackmania.svg' },
  { slug: 'chess', name: 'Chess', icon: '/games/chess.svg' },
  { slug: 'minecraft', name: 'Minecraft', aliases: ['mc'], icon: '/games/minecraft.svg' },
  { slug: 'ea-sports-fc-25', name: 'EA Sports FC', aliases: ['fifa', 'fc'] },
  {
    slug: 'super-smash-bros-ultimate',
    name: 'Super Smash Bros. Ultimate',
    aliases: ['smash', 'ssbu'],
  },
  { slug: 'street-fighter-6', name: 'Street Fighter 6', aliases: ['sf6'] },
  { slug: 'tekken-8', name: 'Tekken 8' },
  { slug: 'osu', name: 'osu!', icon: '/games/osu.svg' },
  {
    slug: 'team-fortress-2',
    name: 'Team Fortress 2',
    aliases: ['tf2'],
    icon: '/games/team-fortress-2.svg',
  },
  {
    slug: 'age-of-empires-ii',
    name: 'Age of Empires II',
    aliases: ['aoe2', 'aoe'],
    icon: '/games/age-of-empires-ii.svg',
  },
];

/** The name this module shows for a catalogue id it ships, or null. */
export function catalogNameFor(slug: string): string | null {
  const wanted = slug.trim().toLowerCase();
  return MANUAL_REPORT_CATALOG.find((entry) => entry.slug === wanted)?.name ?? null;
}
