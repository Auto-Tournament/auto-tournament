/**
 * The admins' live matches overview: every match on a server right now
 * (loaded or live, and ready ones a server was just given), across tournaments
 * and matchmaking, in one compact read. Per match: the teams with each
 * player's connection and ready, the map, phase, round and scores, a pause,
 * the open admin call and the server. The live parts come from the Ready Up
 * server's state (fleet/state.ts); a match without one has its roster from the
 * config, nobody connected.
 *
 * Admins refresh it on `match:update` and the admin call socket events.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../config/database';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { describeMatch } from '../../../utils/matchIntegration';
import { getLiveState, type LiveMatchRecord } from '../fleet/state';
import { fleetServerStatus } from '../fleet/driver';
import { isLinkedServer } from '../driver';
import type { MatchState, StateTeam } from '../fleet/protocol/v1';

const router = Router();

export interface LiveOverviewPlayer {
  steamId: string;
  name: string;
  connected: boolean;
  ready: boolean;
}

export interface LiveOverviewTeam {
  id: string | null;
  name: string;
  /** This map's side, when known. */
  side: 'ct' | 't' | null;
  /** This map's score. */
  score: number;
  /** Maps won in the series. */
  seriesScore: number;
  players: LiveOverviewPlayer[];
}

export interface LiveOverviewMatch {
  slug: string;
  status: string;
  source: 'tournament' | 'matchmaking' | 'manual';
  tournament: { id: number; name: string } | null;
  team1: LiveOverviewTeam;
  team2: LiveOverviewTeam;
  /** Ready Up's phase (warmup, knife, live, paused, …); null with no live state. */
  phase: string | null;
  map: { number: number; name: string | null } | null;
  numMaps: number | null;
  round: number | null;
  /** Players ready of those required (warmup). */
  ready: { ready: number | null; total: number | null; required: number | null } | null;
  pause: {
    active: true;
    type: string | null;
    /** Who paused: a player's name, a team, or the admin's name. */
    by: string | null;
    /** Unix seconds. */
    since: number | null;
    unpause: { team1: boolean; team2: boolean };
  } | null;
  call: {
    id: number;
    playerName: string | null;
    playerTeam: string | null;
    message: string;
    calledAt: string;
    claimedBy: string | null;
    claimedByName: string | null;
  } | null;
  server: { id: string; name: string | null; online: boolean | null } | null;
  /** Unix seconds of the last live state change; null with no live state. */
  updatedAt: number | null;
}

export interface LiveOverviewRow {
  slug: string;
  status: string;
  game: string | null;
  config: string | null;
  source: string | null;
  round: number | null;
  tournament_id: number | null;
  tournament_name: string | null;
  team1_id: string | null;
  team2_id: string | null;
  t1: string | null;
  t2: string | null;
  server_id: string | null;
  server_name: string | null;
  call_id: number | null;
  call_player_name: string | null;
  call_player_team: string | null;
  call_message: string | null;
  call_called_at: number | null;
  call_claimed_by: string | null;
  call_claimed_by_name: string | null;
}

function playersOf(team: StateTeam | undefined): LiveOverviewPlayer[] {
  return Object.entries(team?.players ?? {})
    .filter(([, p]) => !p.role || p.role === 'player')
    .map(([steamId, p]) => ({
      steamId,
      name: p.name || steamId,
      connected: Boolean(p.connected),
      ready: Boolean(p.ready),
    }));
}

/** A pause's `by` as a name: a rostered player's, else what the server said. */
function pausedBy(state: MatchState, by: string | undefined): string | null {
  if (!by) return null;
  const player = state.teams?.team1?.players?.[by] ?? state.teams?.team2?.players?.[by];
  if (player?.name) return player.name;
  if (by === 'team1' || by === 'team2') return state.teams?.[by]?.name ?? by;
  return by;
}

/** The match's config: its team names, and the roster, nobody connected (no live state yet). */
function fromConfig(row: LiveOverviewRow): Array<{ name: string; players: LiveOverviewPlayer[] }> {
  try {
    const config = row.config ? (JSON.parse(row.config) as unknown) : null;
    const described = describeMatch({ game: (row.game ?? 'cs2') as never, config });
    return [described.team1, described.team2].map((t) => ({
      name: t.name,
      players: t.players.map((p) => ({
        steamId: p.account.externalId,
        name: p.name || p.account.externalId,
        connected: false,
        ready: false,
      })),
    }));
  } catch {
    return [
      { name: '', players: [] },
      { name: '', players: [] },
    ];
  }
}

/** One overview card from the match row and its live record (pure: tested on its own). */
export function liveOverviewItem(
  row: LiveOverviewRow,
  live: Pick<LiveMatchRecord, 'state' | 'updatedAt'> | null,
  serverOnline: boolean | null
): LiveOverviewMatch {
  const state = live?.state ?? null;
  const configured = fromConfig(row);
  const current = state?.series?.current_map ?? null;
  const currentMap = current ? state?.series?.maps?.[String(current)] : undefined;
  const team = (key: 'team1' | 'team2', id: string | null, name: string | null) => {
    const t = state?.teams?.[key];
    const config = configured[key === 'team1' ? 0 : 1];
    return {
      id,
      name: name || config.name || t?.name || (key === 'team1' ? 'Team 1' : 'Team 2'),
      side: t?.side ?? null,
      score: t?.score ?? currentMap?.score?.[key] ?? 0,
      seriesScore: state?.series?.score?.[key] ?? 0,
      players: state ? playersOf(t) : config.players,
    };
  };
  const pause = state?.pause?.active
    ? {
        active: true as const,
        type: state.pause.type ?? null,
        by: pausedBy(state, state.pause.by),
        since: state.pause.started_at ?? null,
        unpause: {
          team1: Boolean(state.pause.unpause?.team1),
          team2: Boolean(state.pause.unpause?.team2),
        },
      }
    : null;
  return {
    slug: row.slug,
    status: row.status,
    source:
      row.source === 'matchmaking' ? 'matchmaking' : row.tournament_id ? 'tournament' : 'manual',
    tournament:
      row.tournament_id && row.tournament_name
        ? { id: Number(row.tournament_id), name: row.tournament_name }
        : null,
    team1: team('team1', row.team1_id, row.t1),
    team2: team('team2', row.team2_id, row.t2),
    phase: state?.phase ?? null,
    map: current ? { number: current, name: currentMap?.name ?? null } : null,
    numMaps: state?.series?.num_maps ?? null,
    round: state?.round?.number ?? null,
    ready: state?.ready
      ? {
          ready: state.ready.ready ?? null,
          total: state.ready.total ?? null,
          required: state.ready.required_per_team ?? null,
        }
      : null,
    pause,
    call:
      row.call_id === null
        ? null
        : {
            id: Number(row.call_id),
            playerName: row.call_player_name,
            playerTeam: row.call_player_team,
            message: row.call_message ?? '',
            calledAt: new Date(Number(row.call_called_at) * 1000).toISOString(),
            claimedBy: row.call_claimed_by,
            claimedByName: row.call_claimed_by_name,
          },
    server: row.server_id
      ? { id: row.server_id, name: row.server_name, online: serverOnline }
      : null,
    updatedAt: live?.updatedAt ?? null,
  };
}

/**
 * @openapi
 * /api/game/cs2/live-overview:
 *   get:
 *     tags: [Live matches]
 *     summary: Every match on a server now, with its live state (admin only)
 *     description: |
 *       The matches that are loaded or live (or ready with a server), in every tournament and
 *       matchmaking, live ones first. Per match: teams with side, map score,
 *       series score and players (connected, ready); the map, phase and round;
 *       the ready count; a pause (type, by, since, which teams want to
 *       unpause); the open admin call with who claimed it; the server. Refresh
 *       on the `match:update`, `admin:call`, `admin:call:claimed` and
 *       `admin:call:resolved` socket events.
 *     responses:
 *       200: { description: "{ matches: LiveOverviewMatch[] }" }
 *       401: { description: Not an admin }
 */
router.get('/live-overview', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await db.queryAsync<LiveOverviewRow>(
      `SELECT m.slug, m.status, m.game, m.config, m.source, m.round, m.tournament_id,
              tr.name AS tournament_name, m.team1_id, m.team2_id, t1.name AS t1, t2.name AS t2,
              m.server_id, s.name AS server_name,
              ac.id AS call_id, ac.player_name AS call_player_name, ac.player_team AS call_player_team,
              ac.message AS call_message, ac.called_at AS call_called_at,
              ac.claimed_by AS call_claimed_by, cp.name AS call_claimed_by_name
         FROM matches m
         LEFT JOIN tournament tr ON tr.id = m.tournament_id
         LEFT JOIN teams t1 ON t1.id = m.team1_id
         LEFT JOIN teams t2 ON t2.id = m.team2_id
         LEFT JOIN cs2_servers s ON s.id = m.server_id
         LEFT JOIN LATERAL (
           SELECT a.* FROM admin_calls a
            WHERE a.match_slug = m.slug AND a.resolved_at IS NULL
            ORDER BY a.received_at DESC LIMIT 1
         ) ac ON TRUE
         LEFT JOIN players cp ON cp.id = ac.claimed_by
        WHERE (m.status IN ('loaded', 'live') OR (m.status = 'ready' AND m.server_id IS NOT NULL))
          AND (m.game IS NULL OR m.game = 'cs2')
        ORDER BY (m.status = 'live') DESC, (m.status = 'loaded') DESC, m.id ASC
        LIMIT 100`
    );
    const matches: LiveOverviewMatch[] = [];
    for (const row of rows) {
      const live = await getLiveState(row.slug);
      let online: boolean | null = null;
      if (row.server_id && (await isLinkedServer(row.server_id))) {
        online = (await fleetServerStatus(row.server_id)).online;
      }
      matches.push(liveOverviewItem(row, live, online));
    }
    return res.json({ success: true, matches });
  } catch (error) {
    log.error('Error reading the live matches overview', error as Error);
    return res.status(500).json({ success: false, error: 'Could not read the live matches' });
  }
});

export default router;
