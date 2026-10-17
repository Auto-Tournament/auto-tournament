/**
 * Match lineups: who plays a match for a team whose roster is bigger than the
 * tournament's team size (a five-player team in a 2v2). Design:
 * docs/design/match-lineups.md.
 *
 * - The pool is the team's tournament lineup when it signed up with one, else
 *   its roster (`tournamentSignupService.lineupRoster`), in that order.
 * - When the pool is bigger than the team size, the match uses `size` of
 *   them. No `match_lineups` row means the default: the team's lineup from
 *   its last match in the tournament, else the first `size` of the pool.
 * - The team's owner or a captain sets it (any member of a team with
 *   neither); an admin sets either team's. Only before the match goes live, or
 *   between maps of a series (the game module's `betweenMaps`).
 * - The game module builds the match's roster from `lineupFor` and is told
 *   about a change (`onLineupChanged`; CS2: `match.update` to Ready Up).
 *
 * Shuffle tournaments and standalone matches have no lineups: their sides are
 * drawn or typed per match.
 */

import { db } from '../config/database';
import type { DbMatchRow } from '../types/database.types';
import { log } from '../utils/logger';
import { integrationForMatch } from '../integrations/registry';
import { matchContextFor } from '../utils/matchIntegration';
import { emitMatchUpdate } from './socketService';
import { teamMembers } from './teamMembers';
import { tournamentSignupService } from './tournamentSignupService';

export type Side = 'team1' | 'team2';

export class LineupError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

export interface PoolPlayer {
  steamId: string;
  name: string;
  avatar: string | null;
}

export interface TeamLineup {
  side: Side;
  teamId: string;
  teamName: string;
  /** Players per side. */
  size: number;
  /** Who can be picked, in roster order. */
  pool: PoolPlayer[];
  /** Who plays (Steam IDs), `size` of them. */
  players: string[];
  /** Where `players` came from: set for this match, the team's last match, or the roster order. */
  source: 'set' | 'previous' | 'roster';
  /** The viewer may change it. */
  canEdit: boolean;
}

export interface MatchLineups {
  slug: string;
  /** Lineups can change now (before go-live, or between maps). */
  open: boolean;
  /** Only the teams whose pool is bigger than the team size. */
  teams: TeamLineup[];
}

export interface LineupViewer {
  uid: string | null;
  steamId: string | null;
  admin: boolean;
}

interface TeamRow {
  id: string;
  name: string;
  players: string | null;
  owner_uid: string | null;
}

interface TournamentRow {
  id: number;
  type: string;
  format: string;
  team_size: number | null;
  settings: string | null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Roster JSON (array, or the `{0: {...}}` shape) → players with a Steam ID, in order. */
export function poolFromRoster(rosterJson: string | null | undefined): PoolPlayer[] {
  const parsed = parseJson<unknown>(rosterJson, []);
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : [];
  const seen = new Set<string>();
  const out: PoolPlayer[] = [];
  for (const raw of entries) {
    const p = raw as { steamId?: unknown; steamid?: unknown; name?: unknown; avatar?: unknown };
    const steamId = typeof p?.steamId === 'string' ? p.steamId : p?.steamid;
    if (typeof steamId !== 'string' || !steamId || seen.has(steamId)) continue;
    seen.add(steamId);
    out.push({
      steamId,
      name: typeof p.name === 'string' && p.name ? p.name : steamId,
      avatar: typeof p.avatar === 'string' && p.avatar ? p.avatar : null,
    });
  }
  return out;
}

/**
 * The lineup from what is stored (pure): the ids still in the pool, topped up
 * from the pool in order up to `size`.
 */
export function fillLineup(stored: readonly string[], pool: readonly string[], size: number) {
  const inPool = new Set(pool);
  const out: string[] = [];
  for (const id of stored) {
    if (inPool.has(id) && !out.includes(id) && out.length < size) out.push(id);
  }
  for (const id of pool) {
    if (out.length >= size) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

async function tournamentRow(id: number | null | undefined): Promise<TournamentRow | null> {
  if (!id) return null;
  return (
    (await db.queryOneAsync<TournamentRow>(
      'SELECT id, type, format, team_size, settings FROM tournament WHERE id = ?',
      [id]
    )) ?? null
  );
}

async function teamRow(id: string | null | undefined): Promise<TeamRow | null> {
  if (!id) return null;
  return (
    (await db.queryOneAsync<TeamRow>(
      'SELECT id, name, players, owner_uid FROM teams WHERE id = ?',
      [id]
    )) ?? null
  );
}

/** Players per side for a tournament's matches (the game may fix it: CS2 wingman is 2). */
function sizeFor(tournament: TournamentRow, game: string | null | undefined): number {
  const teamSize = Number(tournament.team_size) > 0 ? Number(tournament.team_size) : 5;
  const integration = integrationForMatch({ game });
  const fixed = integration.lineupSize?.(
    {
      id: tournament.id,
      type: tournament.type,
      format: tournament.format,
      settings: parseJson<unknown>(tournament.settings, {}),
    },
    teamSize
  );
  return typeof fixed === 'number' && fixed > 0 ? fixed : teamSize;
}

/** A tournament match that can have lineups (not shuffle, not standalone). */
function hasLineups(
  match: Pick<DbMatchRow, 'round' | 'tournament_id'>,
  tournament: TournamentRow | null
): tournament is TournamentRow {
  return !!tournament && match.round >= 1 && !!match.tournament_id && tournament.type !== 'shuffle';
}

async function pool(tournamentId: number, team: TeamRow): Promise<PoolPlayer[]> {
  const roster = await tournamentSignupService.lineupRoster(
    tournamentId,
    team.id,
    team.players ?? '[]'
  );
  return poolFromRoster(roster);
}

async function storedLineup(
  slug: string,
  teamId: string,
  tournamentId: number
): Promise<{ players: string[]; source: TeamLineup['source'] } | null> {
  const own = await db.queryOneAsync<{ players: string }>(
    'SELECT players FROM match_lineups WHERE match_slug = ? AND team_id = ?',
    [slug, teamId]
  );
  if (own) return { players: parseJson<string[]>(own.players, []), source: 'set' };
  const previous = await db.queryOneAsync<{ players: string }>(
    `SELECT l.players FROM match_lineups l JOIN matches m ON m.slug = l.match_slug
      WHERE l.team_id = ? AND m.tournament_id = ? AND l.match_slug <> ?
      ORDER BY l.updated_at DESC LIMIT 1`,
    [teamId, tournamentId, slug]
  );
  if (previous) return { players: parseJson<string[]>(previous.players, []), source: 'previous' };
  return null;
}

async function resolve(
  slug: string,
  tournamentId: number,
  team: TeamRow,
  size: number
): Promise<{ pool: PoolPlayer[]; players: string[]; source: TeamLineup['source'] } | null> {
  const players = await pool(tournamentId, team);
  if (players.length <= size) return null;
  const ids = players.map((p) => p.steamId);
  const stored = await storedLineup(slug, team.id, tournamentId);
  return {
    pool: players,
    players: fillLineup(stored?.players ?? [], ids, size),
    source: stored?.source ?? 'roster',
  };
}

/**
 * Who plays the match for a team, for the game module's config: the lineup's
 * Steam IDs, or null when the team plays with its whole pool (it fits the
 * team size, or the match has no lineups).
 */
export async function lineupFor(
  slug: string,
  tournamentId: number,
  teamId: string,
  game?: string | null
): Promise<Set<string> | null> {
  try {
    const tournament = await tournamentRow(tournamentId);
    if (!tournament || tournament.type === 'shuffle') return null;
    const team = await teamRow(teamId);
    if (!team) return null;
    const lineup = await resolve(slug, tournament.id, team, sizeFor(tournament, game));
    return lineup ? new Set(lineup.players) : null;
  } catch (error) {
    // The match plays with the whole pool rather than not at all.
    log.warn(`[LINEUP] ${slug}: lineup not read: ${(error as Error).message}`);
    return null;
  }
}

/** The team's owner or a captain; any member of a team that has neither. */
async function mayActFor(team: TeamRow, viewer: LineupViewer): Promise<boolean> {
  if (!viewer.uid && !viewer.steamId) return false;
  if (viewer.uid && team.owner_uid === viewer.uid) return true;
  const role = viewer.uid ? await teamMembers.roleFor(team.id, viewer.uid) : null;
  if (role === 'captain') return true;
  const captains = await db.queryOneAsync<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = ? AND role = 'captain'",
    [team.id]
  );
  if (team.owner_uid || Number(captains?.n ?? 0) > 0) return false;
  if (role) return true;
  return !!viewer.steamId && poolFromRoster(team.players).some((p) => p.steamId === viewer.steamId);
}

/** Lineups can change: before the match goes live, or between maps of a series. */
async function lineupsOpen(match: DbMatchRow): Promise<boolean> {
  if (['pending', 'ready', 'loaded'].includes(match.status)) return true;
  if (match.status !== 'live') return false;
  const integration = integrationForMatch(match);
  if (!integration.betweenMaps) return false;
  try {
    return await integration.betweenMaps(await matchContextFor(match));
  } catch {
    return false;
  }
}

async function matchRow(slug: string): Promise<DbMatchRow> {
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
  if (!match) throw new LineupError(404, 'Match not found');
  return match;
}

export async function getMatchLineups(slug: string, viewer: LineupViewer): Promise<MatchLineups> {
  const match = await matchRow(slug);
  const tournament = await tournamentRow(match.tournament_id);
  if (!hasLineups(match, tournament)) return { slug, open: false, teams: [] };
  const open = await lineupsOpen(match);
  const size = sizeFor(tournament, match.game);
  const teams: TeamLineup[] = [];
  for (const side of ['team1', 'team2'] as const) {
    const team = await teamRow(side === 'team1' ? match.team1_id : match.team2_id);
    if (!team) continue;
    const lineup = await resolve(slug, tournament.id, team, size);
    if (!lineup) continue;
    teams.push({
      side,
      teamId: team.id,
      teamName: team.name,
      size,
      ...lineup,
      canEdit: open && (viewer.admin || (await mayActFor(team, viewer))),
    });
  }
  return { slug, open, teams };
}

export interface SetLineupResult {
  lineups: MatchLineups;
  /** The server running the match got the change, or why not (the lineup is saved either way). */
  serverSync: { ok: true } | { ok: false; error: string };
}

export async function setMatchLineup(
  slug: string,
  side: Side,
  players: unknown,
  viewer: LineupViewer
): Promise<SetLineupResult> {
  const match = await matchRow(slug);
  const tournament = await tournamentRow(match.tournament_id);
  if (!hasLineups(match, tournament)) {
    throw new LineupError(409, 'This match has no lineups.', 'no_lineups');
  }
  const team = await teamRow(side === 'team1' ? match.team1_id : match.team2_id);
  if (!team) throw new LineupError(409, 'That side has no team yet.', 'no_team');
  if (!viewer.admin && !(await mayActFor(team, viewer))) {
    throw new LineupError(
      403,
      'Only the team owner or a captain can pick the lineup.',
      'not_captain'
    );
  }
  if (!(await lineupsOpen(match))) {
    throw new LineupError(
      409,
      'The lineup can only change before the match goes live, or between maps.',
      'locked'
    );
  }
  const size = sizeFor(tournament, match.game);
  const teamPool = await pool(tournament.id, team);
  if (teamPool.length <= size) {
    throw new LineupError(409, 'The whole team plays: it is not bigger than the team size.');
  }
  const ids = Array.isArray(players)
    ? players.filter((p): p is string => typeof p === 'string')
    : [];
  if (new Set(ids).size !== ids.length) {
    throw new LineupError(400, 'A player is in the lineup twice.');
  }
  const inPool = new Set(teamPool.map((p) => p.steamId));
  if (ids.some((id) => !inPool.has(id))) {
    throw new LineupError(400, 'Every player in the lineup must be on the team.');
  }
  if (ids.length !== size) throw new LineupError(400, `Pick ${size} players.`, 'count');

  await db.runAsync(
    `INSERT INTO match_lineups (match_slug, team_id, players, set_by, updated_at)
     VALUES (?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
     ON CONFLICT (match_slug, team_id)
     DO UPDATE SET players = EXCLUDED.players, set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at`,
    [slug, team.id, JSON.stringify(ids), viewer.steamId]
  );
  log.info(
    `[LINEUP] ${slug}: ${team.name} plays ${ids.join(', ')}${viewer.admin ? ' (set by an admin)' : ''}`
  );

  let serverSync: SetLineupResult['serverSync'] = { ok: true };
  const integration = integrationForMatch(match);
  if (integration.onLineupChanged) {
    try {
      await integration.onLineupChanged(await matchContextFor(match));
    } catch (error) {
      serverSync = { ok: false, error: (error as Error).message };
      log.warn(`[LINEUP] ${slug}: the server did not take the lineup: ${serverSync.error}`);
    }
  }
  emitMatchUpdate({ id: match.id, slug, lineup: true });
  return { lineups: await getMatchLineups(slug, viewer), serverSync };
}
