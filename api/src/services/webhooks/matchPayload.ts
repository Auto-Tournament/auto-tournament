/**
 * A match as the integrator webhooks describe it (`data.match`).
 *
 * Read from the same places the rest of the platform reads: the match row,
 * the teams' rosters (a bracket match's config is built from them), the
 * integration's `describeMatch` for the series and maps, the stored map
 * results, the live score (`matchLiveStatsService`), and the integration's
 * `connectInfo` for how to join.
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { integrationForMatch } from '../../integrations/registry';
import type { MatchDescription, MatchDescriptionTeam } from '../../integrations/types';
import type { DbMatchRow } from '../../types/database.types';
import { matchLiveStatsService } from '../matchLiveStatsService';
import { getMapResults, type MatchMapResultRecord } from '../matchMapResultService';
import { currentMatchConfig } from '../../utils/matchIntegration';
import { externalIdsForTeams } from '../teamExternalIds';
import {
  connectLinks,
  type TeamSide,
  type WebhookConnect,
  type WebhookMapScore,
  type WebhookMatch,
  type WebhookPlayer,
  type WebhookTeam,
} from './events';

/** Statuses in which players can join (the match is on a server). */
export const CONNECTABLE_STATUSES: ReadonlySet<string> = new Set(['loaded', 'live']);

export interface MatchFacts {
  row: DbMatchRow & { status: string };
  status: string;
  serverId: string | null;
  /** 0-based index of the current map. */
  mapNumber: number;
  mapName: string | null;
  mapScore: { team1: number; team2: number };
  results: MatchMapResultRecord[];
  connect: WebhookConnect | null;
}

export async function readMatchRow(ref: { slug?: string | null; id?: number | null }): Promise<(DbMatchRow & { status: string }) | null> {
  if (ref.slug) {
    return (await db.queryOneAsync<DbMatchRow & { status: string }>('SELECT * FROM matches WHERE slug = ?', [ref.slug])) ?? null;
  }
  if (typeof ref.id === 'number') {
    return (await db.queryOneAsync<DbMatchRow & { status: string }>('SELECT * FROM matches WHERE id = ?', [ref.id])) ?? null;
  }
  return null;
}

/** The facts the event reconciler compares, read fresh. */
export async function readMatchFacts(row: DbMatchRow & { status: string }): Promise<MatchFacts> {
  const live = matchLiveStatsService.getStats(row.slug);
  const results = await getMapResults(row.slug);
  const mapNumber = typeof live?.mapNumber === 'number' ? live.mapNumber : (row.map_number ?? 0);
  const liveOnThisMap = live && live.mapNumber === mapNumber;
  const mapScore = liveOnThisMap ? { team1: live.team1Score ?? 0, team2: live.team2Score ?? 0 } : { team1: 0, team2: 0 };
  const mapName = (liveOnThisMap && live?.mapName) || row.current_map || null;

  let connect: WebhookConnect | null = null;
  if (CONNECTABLE_STATUSES.has(row.status) && row.server_id) {
    try {
      const info = await integrationForMatch(row).connectInfo?.(row);
      if (info) connect = { host: info.host, port: info.port, password: info.password, ...connectLinks(info.host, info.port, info.password) };
    } catch (error) {
      log.warn('[Webhooks] Could not read how to join a match', {
        matchSlug: row.slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    row,
    status: row.status,
    serverId: row.server_id ?? null,
    mapNumber,
    mapName,
    mapScore,
    results,
    connect,
  };
}

interface TeamRow {
  id: string;
  name: string;
  tag: string | null;
  players: string;
}

function rosterOf(teamRow: TeamRow | undefined, described: MatchDescriptionTeam | undefined): WebhookPlayer[] {
  if (teamRow) {
    try {
      const parsed: unknown = JSON.parse(teamRow.players);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((p): p is { steamId: string; name?: string } => !!p && typeof (p as { steamId?: unknown }).steamId === 'string')
          .map((p) => ({ steam_id64: p.steamId, name: typeof p.name === 'string' ? p.name : p.steamId }));
      }
    } catch {
      // Fall through to the described roster.
    }
  }
  return (described?.players ?? []).map((p) => ({ steam_id64: p.account.externalId, name: p.name }));
}

function winnerOf(record: MatchMapResultRecord): WebhookMapScore['winner'] {
  if (record.winnerTeam === 'team1' || record.winnerTeam === 'team2') return record.winnerTeam;
  if (record.winnerTeam === 'none') return 'draw';
  if (record.team1Score > record.team2Score) return 'team1';
  if (record.team2Score > record.team1Score) return 'team2';
  return 'draw';
}

async function describe(row: DbMatchRow): Promise<MatchDescription | null> {
  try {
    const config = await currentMatchConfig(row);
    return integrationForMatch(row).describeMatch(config);
  } catch {
    try {
      return integrationForMatch(row).describeMatch(row.config ? JSON.parse(row.config) : null);
    } catch {
      return null;
    }
  }
}

/**
 * `data.match` for these facts. `external_id` is left null here: it depends
 * on the endpoint's source and is filled per delivery (`forEndpoint`).
 */
export async function buildMatchPayload(facts: MatchFacts): Promise<WebhookMatch> {
  const row = facts.row;
  const description = await describe(row);

  const teamIds = [row.team1_id, row.team2_id].filter((id): id is string => !!id);
  const teamRows = teamIds.length
    ? await db.queryAsync<TeamRow>(
        `SELECT id, name, tag, players FROM teams WHERE id IN (${teamIds.map(() => '?').join(', ')})`,
        teamIds
      )
    : [];
  const externalIds = await externalIdsForTeams(teamIds);
  const tournament = row.tournament_id
    ? await db.queryOneAsync<{ id: number; name: string }>('SELECT id, name FROM tournament WHERE id = ?', [
        row.tournament_id,
      ])
    : undefined;

  const team = (side: TeamSide): WebhookTeam | null => {
    const id = side === 'team1' ? row.team1_id : row.team2_id;
    const teamRow = id ? teamRows.find((t) => t.id === id) : undefined;
    const described = description?.[side];
    if (!teamRow && !described?.name && !(described?.players?.length ?? 0)) return null;
    return {
      id: teamRow?.id ?? id ?? null,
      external_id: null,
      external_ids: (id && externalIds.get(id)) || {},
      name: teamRow?.name ?? described?.name ?? '',
      tag: teamRow?.tag ?? described?.tag ?? null,
      players: rosterOf(teamRow, described),
    };
  };

  const seriesLength = Math.max(1, description?.seriesLength ?? 1);
  const plannedMaps = description?.maps ?? [];
  const maps: WebhookMapScore[] = [];
  const status: string = row.status;
  const finishedStatus = status === 'completed' || status === 'cancelled' || status === 'needs_decision';
  for (let i = 0; i < seriesLength; i++) {
    const result = facts.results.find((r) => r.mapNumber === i);
    if (result) {
      maps.push({
        number: i + 1,
        name: result.mapName ?? plannedMaps[i] ?? null,
        team1: result.team1Score,
        team2: result.team2Score,
        status: 'finished',
        winner: winnerOf(result),
      });
    } else if (i === facts.mapNumber && row.status === 'live') {
      maps.push({
        number: i + 1,
        name: facts.mapName ?? plannedMaps[i] ?? null,
        team1: facts.mapScore.team1,
        team2: facts.mapScore.team2,
        status: 'live',
        winner: null,
      });
    } else if (!finishedStatus) {
      maps.push({ number: i + 1, name: plannedMaps[i] ?? null, team1: 0, team2: 0, status: 'upcoming', winner: null });
    }
  }

  const series = { team1: 0, team2: 0 };
  for (const r of facts.results) {
    const w = winnerOf(r);
    if (w === 'team1') series.team1++;
    else if (w === 'team2') series.team2++;
  }

  const current = maps.find((m) => m.status === 'live') ?? [...maps].reverse().find((m) => m.status === 'finished') ?? null;
  const winnerSide: TeamSide | null =
    row.winner_id && row.winner_id === row.team1_id ? 'team1' : row.winner_id && row.winner_id === row.team2_id ? 'team2' : null;

  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    game: row.game ?? 'cs2',
    round: row.round,
    match_number: row.match_number,
    bracket: row.bracket ?? null,
    best_of: seriesLength,
    tournament: tournament ? { id: tournament.id, name: tournament.name } : null,
    team1: team('team1'),
    team2: team('team2'),
    score: {
      series,
      map: current ? { number: current.number, name: current.name, team1: current.team1, team2: current.team2 } : null,
    },
    maps,
    winner: winnerSide ? { side: winnerSide, team_id: row.winner_id ?? null } : null,
    connect: CONNECTABLE_STATUSES.has(row.status) ? facts.connect : null,
  };
}

/** The payload's teams with `external_id` set for an endpoint's source. */
export function forEndpoint(match: WebhookMatch, source: string | null): WebhookMatch {
  const pick = (t: WebhookTeam | null): WebhookTeam | null => {
    if (!t) return t;
    const values = Object.values(t.external_ids);
    const externalId = source ? (t.external_ids[source] ?? null) : values.length === 1 ? values[0] : null;
    return { ...t, external_id: externalId };
  };
  return { ...match, team1: pick(match.team1), team2: pick(match.team2) };
}
