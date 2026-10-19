/**
 * The core's share cards: match, team, player and tournament pages.
 *
 * Game-neutral: the game a card speaks for is the match's, team's or
 * tournament's own, and a player's main game (`mainGame`). Stats a game does
 * not measure (K/D, ADR) are left out rather than shown as zero.
 */

import { createHash } from 'crypto';
import { db } from '../../config/database';
import { DEFAULT_GAME, type GameIntegration } from '../../integrations/types';
import { listIntegrations } from '../../integrations/registry';
import { tournamentService } from '../tournamentService';
import { tournamentBannerService } from '../tournamentBannerService';
import { tournamentSignupService } from '../tournamentSignupService';
import { moderationOf } from '../playerModeration';
import { ratingGame } from '../gameRatings';
import { fromBytes, fromUrl } from './images';
import type { CardData, CardStat, CardTeam, ShareKind, ShareMeta } from './types';
import type { JsonValue } from '../../utils/json';

const DAY = 24 * 3600;

export const versionOf = (...parts: Array<JsonValue | undefined>) =>
  createHash('sha1').update(JSON.stringify(parts)).digest('base64url').slice(0, 12);

/**
 * A game as ratings and matches key it: a module's catalogue slug or alias
 * becomes its id (CS2's 'counter-strike-2' → 'cs2'); any other game keeps
 * its catalogue slug.
 */
export function gameKey(
  game: string | null | undefined,
  installed: readonly GameIntegration[] = listIntegrations()
): string {
  const key = ratingGame(game);
  const owner = installed.find(
    (i) =>
      i.id === key ||
      (i.catalog != null &&
        [i.catalog.slug, ...(i.catalog.aliases ?? [])].some((ref) => ref?.toLowerCase() === key))
  );
  return owner?.id ?? key;
}

/** A game's display name: the catalogue's, else its module's, else the id in capitals ("cs2" → "CS2"). */
export async function gameName(game: string | null | undefined): Promise<string> {
  const key = gameKey(game);
  const owner = listIntegrations().find((i) => i.id === key);
  const row = await db.queryOneAsync<{ name: string }>('SELECT name FROM games WHERE slug = ?', [
    owner?.catalog?.slug || key,
  ]);
  return row?.name || owner?.displayName || key.toUpperCase();
}

const TYPE_LABEL: Record<string, string> = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  round_robin: 'Round robin',
  swiss: 'Swiss',
  shuffle: 'Shuffle',
};

const dayLabel = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/** "de_mirage" → "Mirage"; anything else as it is. */
export function mapLabel(name: string | null): string | null {
  if (!name) return null;
  const bare = name.replace(/^(de|cs|ar|dz|gd|aim|wm)_/i, '').replace(/_/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** The bracket position of a slug ("gf", "lb-r2m1", "t3-r1m2"). */
export function roundLabel(slug: string, round: number): string {
  const bare = slug.replace(/^t\d+-/, '');
  if (bare === 'gf') return 'Grand final';
  if (bare.startsWith('lb-')) return `Lower bracket round ${round}`;
  return round > 0 ? `Round ${round}` : 'Match';
}

// ---------------------------------------------------------------------------
// Match: /match/:slug
// ---------------------------------------------------------------------------

interface MatchRow {
  slug: string;
  round: number;
  status: string;
  game: string | null;
  config: string | null;
  completed_at: number | null;
  team1_id: string | null;
  team2_id: string | null;
  winner_id: string | null;
  t1_name: string | null;
  t2_name: string | null;
  t1_logo_at: number | null;
  t2_logo_at: number | null;
  tournament_name: string | null;
}

async function matchRow(slug: string): Promise<MatchRow | null> {
  const row = await db.queryOneAsync<MatchRow>(
    `SELECT m.slug, m.round, m.status, m.game, m.config, m.completed_at, m.team1_id, m.team2_id, m.winner_id,
            t1.name AS t1_name, t2.name AS t2_name, t1.logo_updated_at AS t1_logo_at, t2.logo_updated_at AS t2_logo_at,
            t.name AS tournament_name
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament t ON t.id = m.tournament_id
      WHERE m.slug = ?`,
    [slug]
  );
  return row ?? null;
}

function teamNameFromConfig(config: string | null, side: 'team1' | 'team2'): string | null {
  try {
    const c = JSON.parse(config ?? '{}') as Record<string, { name?: string } | undefined>;
    return c[side]?.name ?? null;
  } catch {
    return null;
  }
}

function numMaps(config: string | null): number | null {
  try {
    const n = Number((JSON.parse(config ?? '{}') as { num_maps?: number }).num_maps);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function mapResults(slug: string) {
  return db.queryAsync<{
    map_number: number;
    map_name: string | null;
    team1_score: number;
    team2_score: number;
    winner_team: string | null;
  }>(
    'SELECT map_number, map_name, team1_score, team2_score, winner_team FROM match_map_results WHERE match_slug = ? ORDER BY map_number',
    [slug]
  );
}

const teamLogo = async (teamId: string | null) => {
  if (!teamId) return null;
  const row = await db.queryOneAsync<{ logo: Buffer | null; logo_type: string | null }>(
    'SELECT logo, logo_type FROM teams WHERE id = ?',
    [teamId]
  );
  return fromBytes(row?.logo, row?.logo_type);
};

const names = (m: MatchRow) => ({
  team1: m.t1_name ?? teamNameFromConfig(m.config, 'team1') ?? 'TBD',
  team2: m.t2_name ?? teamNameFromConfig(m.config, 'team2') ?? 'TBD',
});

export const matchShare: ShareKind = {
  kind: 'match',
  match: (p) => p.match(/^\/match\/([A-Za-z0-9_-]{1,200})\/?$/)?.[1] ?? null,
  async meta(slug): Promise<ShareMeta | null> {
    if (slug === 'now') return null;
    const m = await matchRow(slug);
    if (!m) return null;
    const maps = await mapResults(slug);
    const n = names(m);
    const wins = maps.reduce(
      (acc, r) => [
        acc[0] + (r.winner_team === 'team1' ? 1 : 0),
        acc[1] + (r.winner_team === 'team2' ? 1 : 0),
      ],
      [0, 0]
    );
    const where = m.tournament_name ? ` · ${m.tournament_name}` : '';
    const state =
      m.status === 'completed'
        ? `${wins[0]}–${wins[1]}`
        : m.status === 'live' || m.status === 'loaded'
          ? 'Live'
          : 'Upcoming';
    return {
      title: `${n.team1} vs ${n.team2}`,
      description: `${state}${where}`,
      version: versionOf(
        m.status,
        wins,
        maps.length,
        m.t1_name,
        m.t2_name,
        m.t1_logo_at,
        m.t2_logo_at
      ),
    };
  },
  async card(slug): Promise<CardData | null> {
    const m = await matchRow(slug);
    if (!m) return null;
    const maps = await mapResults(slug);
    const n = names(m);
    const [logo1, logo2] = await Promise.all([teamLogo(m.team1_id), teamLogo(m.team2_id)]);
    const team1: CardTeam = { name: n.team1, logo: logo1 };
    const team2: CardTeam = { name: n.team2, logo: logo2 };
    const bo = numMaps(m.config);
    const header = [
      m.tournament_name,
      m.tournament_name ? roundLabel(m.slug, m.round) : null,
      bo ? `BO${bo}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const started = ['loaded', 'live', 'completed'].includes(m.status);
    const wins: [number, number] = [
      maps.filter((r) => r.winner_team === 'team1').length,
      maps.filter((r) => r.winner_team === 'team2').length,
    ];
    return {
      kind: 'match',
      header: header || (await gameName(m.game)),
      status:
        m.status === 'completed'
          ? { label: 'Final', tone: 'done' }
          : m.status === 'live' || m.status === 'loaded'
            ? { label: 'Live', tone: 'live' }
            : { label: 'Up next', tone: 'next' },
      team1,
      team2,
      score: started ? wins : null,
      chips: maps.map((r) => {
        const label = mapLabel(r.map_name);
        const score = `${r.team1_score}–${r.team2_score}`;
        return label ? `${label} ${score}` : `Game ${r.map_number + 1} · ${score}`;
      }),
      footer: started ? null : await gameName(m.game),
    };
  },
};

// ---------------------------------------------------------------------------
// Team: /team/:teamId (and the older /t/team/:teamId)
// ---------------------------------------------------------------------------

interface TeamRow {
  id: string;
  name: string;
  game: string | null;
  updated_at: number;
  logo_updated_at: number | null;
}

async function teamRecord(teamId: string) {
  const row = await db.queryOneAsync<{ wins: string | number; losses: string | number }>(
    `SELECT COUNT(*) FILTER (WHERE winner_id = ?) AS wins,
            COUNT(*) FILTER (WHERE winner_id IS NOT NULL AND winner_id <> ?) AS losses
       FROM matches WHERE status = 'completed' AND (team1_id = ? OR team2_id = ?)`,
    [teamId, teamId, teamId, teamId]
  );
  return { wins: Number(row?.wins ?? 0), losses: Number(row?.losses ?? 0) };
}

export const teamShare: ShareKind = {
  kind: 'team',
  match: (p) => p.match(/^\/(?:t\/)?team\/([A-Za-z0-9_-]{1,200})\/?$/)?.[1] ?? null,
  async meta(teamId) {
    const t = await db.queryOneAsync<TeamRow>(
      'SELECT id, name, game, updated_at, logo_updated_at FROM teams WHERE id = ?',
      [teamId]
    );
    if (!t) return null;
    const rec = await teamRecord(teamId);
    const played = rec.wins + rec.losses;
    return {
      title: t.name,
      description:
        played > 0
          ? `${rec.wins} wins, ${rec.losses} losses in ${await gameName(t.game)}`
          : `${await gameName(t.game)} team`,
      version: versionOf(t.name, t.updated_at, t.logo_updated_at, rec),
    };
  },
  async card(teamId) {
    const t = await db.queryOneAsync<TeamRow & { logo: Buffer | null; logo_type: string | null }>(
      'SELECT id, name, game, updated_at, logo_updated_at, logo, logo_type FROM teams WHERE id = ?',
      [teamId]
    );
    if (!t) return null;
    const rec = await teamRecord(teamId);
    const members = await db.queryAsync<{ name: string | null; avatar_url: string | null }>(
      `SELECT p.name, p.avatar_url FROM team_members tm JOIN players p ON p.uid = tm.account_uid
        WHERE tm.team_id = ? AND p.banned_at IS NULL AND p.deleted_at IS NULL
        ORDER BY (tm.role = 'captain') DESC, tm.created_at`,
      [teamId]
    );
    const shown = members.slice(0, 5);
    const avatars = await Promise.all(shown.map((m) => fromUrl(m.avatar_url)));
    const played = rec.wins + rec.losses;
    return {
      kind: 'team',
      label: `Team · ${await gameName(t.game)}`,
      name: t.name,
      logo: fromBytes(t.logo, t.logo_type),
      stats:
        played > 0
          ? [
              { label: 'wins', value: String(rec.wins) },
              { label: 'losses', value: String(rec.losses) },
            ]
          : [],
      note: played > 0 ? null : 'New team · no matches yet',
      members: shown.map((m, i) => ({ name: m.name ?? '?', avatar: avatars[i] })),
      memberCount: members.length,
    };
  },
};

// ---------------------------------------------------------------------------
// Player: /player/:steamId
// ---------------------------------------------------------------------------

/**
 * The game a player's card speaks for: the only game they play, else the
 * first one they picked, else the one they have played most (rated matches).
 */
export async function mainGame(playerId: string): Promise<string> {
  const picked = await db.queryOneAsync<{ slug: string }>(
    `SELECT g.slug FROM players p
       JOIN player_games pg ON pg.player_uid = p.uid
       JOIN games g ON g.id = pg.game_id
      WHERE p.id = ? ORDER BY pg.created_at, g.id LIMIT 1`,
    [playerId]
  );
  if (picked) return gameKey(picked.slug);
  const played = await db.queryOneAsync<{ game: string }>(
    'SELECT game FROM player_game_ratings WHERE player_id = ? ORDER BY match_count DESC, updated_at DESC LIMIT 1',
    [playerId]
  );
  return gameKey(played?.game ?? DEFAULT_GAME);
}

async function playerFacts(playerId: string) {
  const p = await db.queryOneAsync<{
    id: string;
    uid: string | null;
    name: string | null;
    avatar_url: string | null;
    starting_elo: number;
    updated_at: number;
  }>('SELECT id, uid, name, avatar_url, starting_elo, updated_at FROM players WHERE id = ?', [
    playerId,
  ]);
  if (!p) return null;
  const mod = await moderationOf(playerId);
  const game = await mainGame(playerId);
  const rating = await db.queryOneAsync<{ current_elo: number }>(
    'SELECT current_elo FROM player_game_ratings WHERE player_id = ? AND game = ?',
    [playerId, game]
  );
  const month = await db.queryOneAsync<{ first_before: number | null; last_after: number | null }>(
    `SELECT (SELECT elo_before FROM player_rating_history WHERE player_id = ? AND COALESCE(game, ?) = ? AND created_at >= ? ORDER BY created_at, id LIMIT 1) AS first_before,
            (SELECT elo_after FROM player_rating_history WHERE player_id = ? AND COALESCE(game, ?) = ? AND created_at >= ? ORDER BY created_at DESC, id DESC LIMIT 1) AS last_after`,
    [
      playerId,
      DEFAULT_GAME,
      game,
      Math.floor(Date.now() / 1000) - 30 * DAY,
      playerId,
      DEFAULT_GAME,
      game,
      Math.floor(Date.now() / 1000) - 30 * DAY,
    ]
  );
  const stats = await db.queryOneAsync<{
    matches: string | number;
    wins: string | number;
    kills: string | number | null;
    deaths: string | number | null;
    adr: string | number | null;
  }>(
    `SELECT COUNT(DISTINCT pms.match_slug) AS matches,
            COUNT(DISTINCT pms.match_slug) FILTER (WHERE pms.won_match) AS wins,
            SUM(pms.kills) AS kills, SUM(pms.deaths) AS deaths, AVG(pms.adr) AS adr
       FROM player_match_stats pms JOIN matches m ON m.slug = pms.match_slug
      WHERE pms.player_id = ? AND COALESCE(m.game, ?) = ?`,
    [playerId, DEFAULT_GAME, game]
  );
  const team = await db.queryOneAsync<{ name: string }>(
    `SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.account_uid = ? ORDER BY (COALESCE(t.game, ?) = ?) DESC, tm.created_at DESC LIMIT 1`,
    [p.uid, DEFAULT_GAME, game]
  );
  const others = await db.queryAsync<{ name: string; slug: string }>(
    `SELECT g.name, g.slug FROM player_games pg JOIN games g ON g.id = pg.game_id
      WHERE pg.player_uid = ? ORDER BY pg.created_at, g.id`,
    [p.uid]
  );
  return {
    p,
    hidden: mod.banned || mod.deleted,
    game,
    gameName: await gameName(game),
    rating: rating ? Number(rating.current_elo) : Number(p.starting_elo),
    change:
      month?.first_before != null && month?.last_after != null
        ? Number(month.last_after) - Number(month.first_before)
        : 0,
    matches: Number(stats?.matches ?? 0),
    wins: Number(stats?.wins ?? 0),
    kills: stats?.kills == null ? null : Number(stats.kills),
    deaths: stats?.deaths == null ? null : Number(stats.deaths),
    adr: stats?.adr == null ? null : Number(stats.adr),
    team: team?.name ?? null,
    otherGames: others.filter((g) => gameKey(g.slug) !== game).map((g) => g.name),
  };
}

export const playerShare: ShareKind = {
  kind: 'player',
  match: (p) => p.match(/^\/player\/([A-Za-z0-9_.:-]{1,200})\/?$/)?.[1] ?? null,
  async meta(playerId) {
    const f = await playerFacts(playerId);
    if (!f) return null;
    const name = f.p.name ?? 'Player';
    if (f.hidden) return { title: name, description: '', version: versionOf('hidden', name) };
    return {
      title: name,
      description: `Rating ${f.rating} in ${f.gameName} · ${f.matches} match${f.matches === 1 ? '' : 'es'}`,
      version: versionOf(
        name,
        f.p.avatar_url,
        f.rating,
        f.change,
        f.matches,
        f.wins,
        f.team,
        f.game,
        f.otherGames
      ),
    };
  },
  async card(playerId) {
    const f = await playerFacts(playerId);
    if (!f) return null;
    const name = f.p.name ?? 'Player';
    // A banned or deleted player's page shows only the name; so does the card.
    if (f.hidden) {
      return {
        kind: 'player',
        name,
        avatar: null,
        sub: '',
        rating: null,
        ratingChange: 0,
        stats: [],
        footer: null,
      };
    }
    const winRate = f.matches > 0 ? `${Math.round((f.wins / f.matches) * 100)}%` : '–';
    const measured = f.kills !== null && f.deaths !== null && f.adr !== null && f.matches > 0;
    const stats: CardStat[] =
      f.matches === 0
        ? []
        : measured
          ? [
              { label: 'K/D', value: (f.kills! / Math.max(1, f.deaths!)).toFixed(2) },
              { label: 'ADR', value: String(Math.round(f.adr!)) },
              { label: 'Matches', value: String(f.matches) },
              { label: 'Win rate', value: winRate },
            ]
          : [
              { label: 'Matches', value: String(f.matches) },
              { label: 'Wins', value: String(f.wins) },
              { label: 'Win rate', value: winRate },
            ];
    const footer =
      f.matches === 0
        ? `Plays ${[f.gameName, ...f.otherGames].slice(0, 4).join(', ')}`
        : f.otherGames.length > 0
          ? `Also plays ${f.otherGames.slice(0, 3).join(', ')}`
          : null;
    return {
      kind: 'player',
      name,
      avatar: await fromUrl(f.p.avatar_url),
      sub: [f.gameName, f.team].filter(Boolean).join(' · '),
      rating: f.rating,
      ratingChange: f.change,
      stats,
      footer,
    };
  },
};

// ---------------------------------------------------------------------------
// Tournament: /tournament/:id and its tabs
// ---------------------------------------------------------------------------

async function tournamentFacts(id: number) {
  const t = await tournamentService.getTournament(id);
  if (!t) return null;
  const game = await gameName(t.game);
  const teamCount = t.teams?.length ?? t.teamIds?.length ?? 0;
  const when = t.started_at ?? t.created_at;
  const sub = [
    TYPE_LABEL[t.type] ?? t.type,
    t.type === 'shuffle' ? null : `${teamCount} team${teamCount === 1 ? '' : 's'}`,
    when ? dayLabel(Number(when)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  let badge: string | null = null;
  if (t.status === 'in_progress') badge = 'Live now';
  else if (t.status === 'setup') {
    const window = await tournamentSignupService.window(id).catch(() => null);
    badge = window?.registrationOpen ? 'Sign-up open' : 'Coming up';
  }
  return { t, game, sub, badge };
}

export const tournamentShare: ShareKind = {
  kind: 'tournament',
  match: (p) => p.match(/^\/tournament\/(?<id>\d{1,9})(?:\/[a-z-]*)?\/?$/)?.groups?.id ?? null,
  async meta(key) {
    const f = await tournamentFacts(Number(key));
    if (!f) return null;
    const winner = f.t.winner?.name ?? null;
    return {
      title: f.t.name,
      description: [f.game, f.sub, winner ? `Champion: ${winner}` : f.badge]
        .filter(Boolean)
        .join(' · '),
      version: versionOf(f.t.name, f.t.status, f.sub, f.badge, winner, f.t.bannerUrl),
    };
  },
  async card(key) {
    const id = Number(key);
    const f = await tournamentFacts(id);
    if (!f) return null;
    const winner = f.t.winner as { id?: string; name?: string } | null | undefined;
    const banner = f.t.bannerUrl ? await tournamentBannerService.get(id) : null;
    return {
      kind: 'tournament',
      label: `Tournament · ${f.game}`,
      name: f.t.name,
      sub: f.sub,
      banner: fromBytes(banner?.data, banner?.type),
      badge: winner?.name ? null : f.badge,
      champion: winner?.name
        ? { name: winner.name, logo: await teamLogo(winner.id ?? null) }
        : null,
    };
  },
};

export const CORE_SHARE_KINDS: ShareKind[] = [matchShare, teamShare, playerShare, tournamentShare];
