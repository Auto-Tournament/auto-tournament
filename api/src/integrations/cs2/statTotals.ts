/**
 * Each player's numbers summed over a set of matches, for integrators
 * (GET /api/integrations/player-stats, routes/integrationPlayerStats.ts): an
 * event website's stat trophies (most kills, most MVPs, a team kill, ...).
 *
 * What counts: finished series (an import once its last map is in), never a
 * simulation or a bot-filled match, and of those only the maps with a result.
 * Warmup is never in the numbers (Ready Up and the demo analyzer start at the
 * match start); the kill feed's knife round is left out here.
 *
 * Three sources, per player per series:
 *
 * - map lines (cs2_player_map_stats, per map: Ready Up's map result, or the
 *   demo's for a map without one): rounds, kills, deaths, assists, damage,
 *   headshots, KAST rounds, opening kills, clutches won, flashes, aces, and
 *   utility damage when the demo was analyzed;
 * - the series line (player_match_stats, written when the series ends):
 *   MVPs, score, flash assists, and utility damage otherwise. A plugin
 *   (MatchZy Enhanced) server sends only this, so its core numbers come from
 *   here when there are no map lines;
 * - the demo's kill feed (cs2_demo_jobs.kills, per analyzed map): knife kills
 *   and team kills.
 *
 * A number a source doesn't measure for one of the player's series is null
 * for that player, never a partial sum and never a guessed 0: an imported
 * match has no series line (MVPs, score and flash assists are null), a map
 * whose demo wasn't analyzed has no kill feed (knife and team kills are null).
 *
 * `sumPlayerStats` is pure (tests/api/integration-player-stats.spec.ts).
 */

import { db } from '../../config/database';
import { isKnifeRound } from './demos/moments';
import { isDevBotId } from './fleet/normalize';

const STEAM_ID = /^\d{17}$/;
const KNIFE = /^(knife|bayonet)/i;

/** One player's numbers, as integrators read them (null: not measured). */
export interface PlayerStatTotals {
  steamId: string;
  name: string | null;
  matchesPlayed: number;
  matchesWon: number;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  totalDamage: number;
  utilityDamage: number | null;
  flashAssists: number | null;
  mvps: number | null;
  score: number | null;
  adr: number | null;
  kast: number | null;
  teamKills: number | null;
  friendliesFlashed: number | null;
  enemiesFlashed: number | null;
  knifeKills: number | null;
  firstKills: number | null;
  clutches: number | null;
  multiKills5k: number | null;
}

/** A cs2_player_map_stats row (the columns read here). */
export interface MapLine {
  player_id: string;
  map_number: number;
  team: string;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshot_kills: number;
  kast_rounds: number;
  entry_kills: number;
  clutches_won: number;
  enemies_flashed: number;
  friendlies_flashed: number;
  multi_5k: number;
  utility_damage: number;
  demo_analyzed: number;
}

/** A player_match_stats row (the columns read here). */
export interface SeriesLine {
  player_id: string;
  team: string;
  won_match: boolean;
  rounds_played: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  headshots: number | null;
  total_damage: number | null;
  utility_damage: number | null;
  flash_assists: number | null;
  mvps: number | null;
  score: number | null;
}

/** A kill as the demo analysis stores it (worker/stats.go `Kill`). */
export interface FeedKill {
  round: number;
  attacker: string | null;
  victim: string;
  victimBot?: boolean;
  weapon?: string;
  attackerSide?: string | null;
  victimSide?: string | null;
}

/** One finished series and what each source has of it. */
export interface SeriesInput {
  slug: string;
  team1Id: string | null;
  team2Id: string | null;
  winnerId: string | null;
  /** 0-based numbers of the maps with a result. */
  maps: number[];
  mapLines: MapLine[];
  seriesLines: SeriesLine[];
  /** The kill feed of each analyzed map, by map number. */
  feeds: Map<number, FeedKill[]>;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A human player's id: a Steam ID 64 that isn't a dev bot's. */
function isHuman(id: string | null | undefined): id is string {
  return !!id && STEAM_ID.test(id) && !isDevBotId(id);
}

/** Knife kills and team kills of each player on one map's kill feed, knife round left out. */
export function feedCounts(
  kills: FeedKill[]
): Map<string, { knifeKills: number; teamKills: number }> {
  const byRound = new Map<number, FeedKill[]>();
  for (const k of kills) byRound.set(k.round, [...(byRound.get(k.round) ?? []), k]);
  const out = new Map<string, { knifeKills: number; teamKills: number }>();
  for (const [, round] of byRound) {
    if (isKnifeRound(round)) continue;
    for (const k of round) {
      if (!isHuman(k.attacker) || !isHuman(k.victim) || k.victimBot) continue;
      if (k.attacker === k.victim || !k.attackerSide || !k.victimSide) continue;
      const c = out.get(k.attacker) ?? { knifeKills: 0, teamKills: 0 };
      if (k.attackerSide === k.victimSide) c.teamKills += 1;
      else if (KNIFE.test(k.weapon ?? '')) c.knifeKills += 1;
      out.set(k.attacker, c);
    }
  }
  return out;
}

/** Nullable sums: a null in any series makes the total null. */
type Sum = number | null;
const add = (a: Sum, b: Sum): Sum => (a === null || b === null ? null : a + b);

interface Line {
  won: boolean;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  totalDamage: number;
  kastRounds: Sum;
  utilityDamage: Sum;
  flashAssists: Sum;
  mvps: Sum;
  score: Sum;
  teamKills: Sum;
  knifeKills: Sum;
  friendliesFlashed: Sum;
  enemiesFlashed: Sum;
  firstKills: Sum;
  clutches: Sum;
  multiKills5k: Sum;
}

/** One player's line of one series, or null when they didn't play in it. */
function seriesLineOf(
  s: SeriesInput,
  maps: MapLine[],
  series: SeriesLine | undefined,
  feeds: Map<number, Map<string, { knifeKills: number; teamKills: number }>>
): Line | null {
  const playerId = maps[0]?.player_id ?? series?.player_id;
  if (!playerId) return null;
  if (maps.length === 0 && !(num(series?.rounds_played) > 0)) return null;

  const team = maps[0]?.team ?? series?.team;
  const teamId = team === 'team1' ? s.team1Id : team === 'team2' ? s.team2Id : null;
  const won = series ? series.won_match === true : !!teamId && s.winnerId === teamId;
  const sumMaps = (k: keyof MapLine) => maps.reduce((a, m) => a + num(m[k]), 0);
  const fromMaps = maps.length > 0;

  // The maps the player played: those of their map lines, or (a plugin
  // server's series, no map lines) every map of the series.
  const played = fromMaps ? maps.map((m) => Number(m.map_number)) : s.maps;
  const feedSum = (k: 'knifeKills' | 'teamKills'): Sum =>
    played.length > 0 && played.every((m) => feeds.has(m))
      ? played.reduce((a, m) => a + (feeds.get(m)!.get(playerId)?.[k] ?? 0), 0)
      : null;

  const utilityDamage: Sum =
    fromMaps && maps.every((m) => num(m.demo_analyzed) === 1)
      ? sumMaps('utility_damage')
      : series && series.utility_damage !== null
        ? num(series.utility_damage)
        : null;
  const fromSeries = (k: 'flash_assists' | 'mvps' | 'score'): Sum =>
    series && series[k] !== null ? num(series[k]) : null;

  return {
    won,
    rounds: fromMaps ? sumMaps('rounds_played') : num(series?.rounds_played),
    kills: fromMaps ? sumMaps('kills') : num(series?.kills),
    deaths: fromMaps ? sumMaps('deaths') : num(series?.deaths),
    assists: fromMaps ? sumMaps('assists') : num(series?.assists),
    headshotKills: fromMaps ? sumMaps('headshot_kills') : num(series?.headshots),
    totalDamage: fromMaps ? sumMaps('damage') : num(series?.total_damage),
    // A plugin's series KAST is its own percentage (Ready Up's series line
    // stores a count in the same column): only map lines' KAST rounds count.
    kastRounds: fromMaps ? sumMaps('kast_rounds') : null,
    utilityDamage,
    flashAssists: fromSeries('flash_assists'),
    mvps: fromSeries('mvps'),
    score: fromSeries('score'),
    teamKills: feedSum('teamKills'),
    knifeKills: feedSum('knifeKills'),
    friendliesFlashed: fromMaps ? sumMaps('friendlies_flashed') : null,
    enemiesFlashed: fromMaps ? sumMaps('enemies_flashed') : null,
    firstKills: fromMaps ? sumMaps('entry_kills') : null,
    clutches: fromMaps ? sumMaps('clutches_won') : null,
    multiKills5k: fromMaps ? sumMaps('multi_5k') : null,
  };
}

/** Every player's numbers over the series, most kills first. Pure. */
export function sumPlayerStats(
  series: SeriesInput[],
  names: Map<string, string | null> = new Map()
): PlayerStatTotals[] {
  const totals = new Map<string, PlayerStatTotals & { kastRounds: Sum }>();
  for (const s of series) {
    const counted = new Set(s.maps);
    const feeds = new Map(
      [...s.feeds].filter(([m]) => counted.has(m)).map(([m, k]) => [m, feedCounts(k)] as const)
    );
    const mapsBy = new Map<string, MapLine[]>();
    for (const m of s.mapLines) {
      if (!isHuman(m.player_id) || !counted.has(Number(m.map_number))) continue;
      mapsBy.set(m.player_id, [...(mapsBy.get(m.player_id) ?? []), m]);
    }
    const seriesBy = new Map<string, SeriesLine>();
    for (const l of s.seriesLines) if (isHuman(l.player_id)) seriesBy.set(l.player_id, l);

    for (const id of new Set([...mapsBy.keys(), ...seriesBy.keys()])) {
      const line = seriesLineOf(s, mapsBy.get(id) ?? [], seriesBy.get(id), feeds);
      if (!line) continue;
      const t = totals.get(id) ?? {
        steamId: id,
        name: names.get(id) ?? null,
        matchesPlayed: 0,
        matchesWon: 0,
        roundsPlayed: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        headshotKills: 0,
        totalDamage: 0,
        utilityDamage: 0,
        flashAssists: 0,
        mvps: 0,
        score: 0,
        adr: null,
        kast: null,
        kastRounds: 0,
        teamKills: 0,
        friendliesFlashed: 0,
        enemiesFlashed: 0,
        knifeKills: 0,
        firstKills: 0,
        clutches: 0,
        multiKills5k: 0,
      };
      t.matchesPlayed += 1;
      if (line.won) t.matchesWon += 1;
      t.roundsPlayed += line.rounds;
      t.kills += line.kills;
      t.deaths += line.deaths;
      t.assists += line.assists;
      t.headshotKills += line.headshotKills;
      t.totalDamage += line.totalDamage;
      t.kastRounds = add(t.kastRounds, line.kastRounds);
      t.utilityDamage = add(t.utilityDamage, line.utilityDamage);
      t.flashAssists = add(t.flashAssists, line.flashAssists);
      t.mvps = add(t.mvps, line.mvps);
      t.score = add(t.score, line.score);
      t.teamKills = add(t.teamKills, line.teamKills);
      t.knifeKills = add(t.knifeKills, line.knifeKills);
      t.friendliesFlashed = add(t.friendliesFlashed, line.friendliesFlashed);
      t.enemiesFlashed = add(t.enemiesFlashed, line.enemiesFlashed);
      t.firstKills = add(t.firstKills, line.firstKills);
      t.clutches = add(t.clutches, line.clutches);
      t.multiKills5k = add(t.multiKills5k, line.multiKills5k);
      totals.set(id, t);
    }
  }
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return [...totals.values()]
    .map(({ kastRounds, ...t }) => ({
      ...t,
      adr: t.roundsPlayed > 0 ? round1(t.totalDamage / t.roundsPlayed) : null,
      kast:
        t.roundsPlayed > 0 && kastRounds !== null
          ? round1((100 * kastRounds) / t.roundsPlayed)
          : null,
    }))
    .sort((a, b) => b.kills - a.kills || a.steamId.localeCompare(b.steamId));
}

/** Which matches to sum over; a match is in when any given filter takes it. */
export interface StatScope {
  /** Tournament ids (and played matches kept from them when they were deleted). */
  tournaments?: number[];
  /** Match slugs. */
  matches?: string[];
  /** The event name of matches in no tournament (an import's event). */
  event?: string;
}

export interface StatTotalsResult {
  players: PlayerStatTotals[];
  /** The newest change to the numbers counted (unix s), or null without any. */
  updatedAt: number | null;
}

/** A match with bots in it: a simulation or a bot-filled one. */
function hasBots(config: string | null): boolean {
  try {
    const c = JSON.parse(config ?? '{}') as { simulation?: unknown; bot_fill?: unknown };
    return c.simulation === true || c.bot_fill === true;
  } catch {
    return false;
  }
}

/** Read the scope's finished series and sum them (`sumPlayerStats`). */
export async function playerStatTotals(scope: StatScope): Promise<StatTotalsResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope.tournaments?.length) {
    where.push(
      '(m.tournament_id = ANY(?::int[]) OR (m.tournament_id IS NULL AND m.played_in_id = ANY(?::int[])))'
    );
    params.push(scope.tournaments, scope.tournaments);
  }
  if (scope.matches?.length) {
    where.push('m.slug = ANY(?::text[])');
    params.push(scope.matches);
  }
  if (scope.event) {
    where.push('(m.tournament_id IS NULL AND LOWER(m.played_in) = LOWER(?))');
    params.push(scope.event);
  }
  if (where.length === 0) return { players: [], updatedAt: null };

  // Finished series only: an import is 'completed' from the start, and
  // finished once its last map is in (completed_at).
  const matches = (
    await db.queryAsync<{
      slug: string;
      team1_id: string | null;
      team2_id: string | null;
      winner_id: string | null;
      config: string | null;
      completed_at: number | null;
    }>(
      `SELECT m.slug, m.team1_id, m.team2_id, m.winner_id, m.config, m.completed_at
         FROM matches m
        WHERE (${where.join(' OR ')})
          AND m.status = 'completed'
          AND (m.source IS DISTINCT FROM 'import' OR m.completed_at IS NOT NULL)`,
      params
    )
  ).filter((m) => !hasBots(m.config));
  if (matches.length === 0) return { players: [], updatedAt: null };
  const slugs = matches.map((m) => m.slug);

  const [maps, mapLines, seriesLines, jobs] = await Promise.all([
    db.queryAsync<{ match_slug: string; map_number: number; completed_at: number | null }>(
      `SELECT match_slug, map_number, completed_at FROM match_map_results
        WHERE match_slug = ANY(?::text[]) AND winner_team IS NOT NULL`,
      [slugs]
    ),
    db.queryAsync<MapLine & { match_slug: string }>(
      `SELECT match_slug, map_number, player_id, team, rounds_played, kills, deaths, assists, damage,
              headshot_kills, kast_rounds, entry_kills, clutches_won, enemies_flashed,
              friendlies_flashed, multi_5k, utility_damage, demo_analyzed
         FROM cs2_player_map_stats WHERE match_slug = ANY(?::text[])`,
      [slugs]
    ),
    // A series written twice keeps its last line.
    db.queryAsync<SeriesLine & { match_slug: string }>(
      `SELECT DISTINCT ON (match_slug, player_id)
              match_slug, player_id, team, won_match, rounds_played, kills, deaths, assists,
              headshots, total_damage, utility_damage, flash_assists, mvps, score
         FROM player_match_stats WHERE match_slug = ANY(?::text[])
        ORDER BY match_slug, player_id, id DESC`,
      [slugs]
    ),
    db.queryAsync<{
      match_slug: string;
      map_number: number;
      kills: string | null;
      finished_at: number | null;
    }>(
      `SELECT match_slug, map_number, kills, finished_at FROM cs2_demo_jobs
        WHERE match_slug = ANY(?::text[]) AND status = 'done' AND kills IS NOT NULL`,
      [slugs]
    ),
  ]);

  let updatedAt = 0;
  const seen = (t: unknown) => {
    const n = Number(t);
    if (Number.isFinite(n) && n > updatedAt) updatedAt = n;
  };
  const bySlug = new Map<string, SeriesInput>(
    matches.map((m) => {
      seen(m.completed_at);
      return [
        m.slug,
        {
          slug: m.slug,
          team1Id: m.team1_id,
          team2Id: m.team2_id,
          winnerId: m.winner_id,
          maps: [],
          mapLines: [],
          seriesLines: [],
          feeds: new Map(),
        },
      ];
    })
  );
  for (const r of maps) {
    bySlug.get(r.match_slug)?.maps.push(Number(r.map_number));
    seen(r.completed_at);
  }
  for (const r of mapLines) bySlug.get(r.match_slug)?.mapLines.push(r);
  for (const r of seriesLines) bySlug.get(r.match_slug)?.seriesLines.push(r);
  for (const j of jobs) {
    try {
      const kills = JSON.parse(j.kills ?? 'null') as unknown;
      if (!Array.isArray(kills)) continue;
      bySlug.get(j.match_slug)?.feeds.set(Number(j.map_number), kills as FeedKill[]);
      seen(j.finished_at);
    } catch {
      // An unreadable kill feed: that map has none.
    }
  }

  const ids = [...new Set([...mapLines, ...seriesLines].map((r) => r.player_id).filter(isHuman))];
  const names = new Map(
    (
      await db.queryAsync<{ id: string; name: string | null }>(
        'SELECT id, name FROM players WHERE id = ANY(?::text[])',
        [ids]
      )
    ).map((p) => [p.id, p.name] as const)
  );
  const players = sumPlayerStats([...bySlug.values()], names);
  return { players, updatedAt: players.length > 0 && updatedAt > 0 ? updatedAt : null };
}
