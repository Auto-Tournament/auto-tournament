/**
 * The walkover choice after "Getting on the server" (settings.fullTeamMinutes)
 * ran out with one team short (integrations/cs2/fleet/fullTeam.ts opens it):
 * the complete team's owner or a captain takes the walkover or plays them short.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { releaseMatch } from './matchHolds';
import { setSeriesWinnerByAdmin } from '../core/matchLifecycle';
import { requireCaptain, SignupError, tournamentSignupService } from './tournamentSignupService';
import { playerConnectionService } from './playerConnectionService';
import type { Untrusted } from '../utils/untrusted';

/** A tournament's minutes (pure): its setting, else 10; 0: off. */
export function fullTeamMinutesOf(settings: string | null): number {
  try {
    const v = (JSON.parse(settings ?? '{}') as { fullTeamMinutes?: Untrusted }).fullTeamMinutes;
    return typeof v === 'number' && v >= 0 ? v : 10;
  } catch {
    return 10;
  }
}

/** Bots play a simulated match and fill a bot-fill one's empty slots: nobody has to join, so no timer (pure). */
export function botsPlay(config: string | null): boolean {
  try {
    const c = JSON.parse(config ?? '{}') as { simulation?: Untrusted; bot_fill?: Untrusted };
    return c.simulation === true || c.bot_fill === true;
  } catch {
    return false;
  }
}

/** Which teams are short (pure): fewer than `size` connected. */
export function shortSides(connected1: number, connected2: number, size: number) {
  return { team1: connected1 < size, team2: connected2 < size };
}

/** The complete team takes the walkover (or the two minutes ran out), or plays them short. */
export async function decideWalkover(slug: string, take: boolean, actorId: string): Promise<void> {
  const offer = await db.queryOneAsync<{ short_side: string; decided: string | null }>(
    'SELECT short_side, decided FROM match_walkover_offers WHERE match_slug = ?',
    [slug]
  );
  if (!offer || offer.decided) return;
  await db.runAsync('UPDATE match_walkover_offers SET decided = ? WHERE match_slug = ?', [
    take ? 'walkover' : 'play',
    slug,
  ]);
  if (!take) {
    await releaseMatch(slug, { userId: actorId, name: 'Full team' });
    log.info(`[FULL TEAM] ${slug}: the complete team plays them short`);
    return;
  }
  const winner = offer.short_side === 'team1' ? 'team2' : 'team1';
  const result = await setSeriesWinnerByAdmin(slug, winner, actorId);
  log.info(`[FULL TEAM] ${slug}: walkover to ${winner} (${result.ok ? 'set' : result.error})`);
}

/**
 * Auto-start waits (pure): the timer is still running, or ran out under 15 s
 * ago and the full-team check has not held the match yet, and a team is short.
 * Once the choice is made or an admin lets the hold go, it goes ahead.
 */
export function fullTeamPending(state: FullTeamState | null, now: number): boolean {
  if (!state?.deadline || state.offer || now >= state.deadline + 15) return false;
  return state.teams.some((t) => t.players.filter((p) => p.onServer).length < state.size);
}

/** The viewer's captaincy of the complete team, then their choice. */
export async function chooseWalkover(slug: string, uid: string, take: boolean): Promise<void> {
  const row = await db.queryOneAsync<{
    short_side: string;
    decided: string | null;
    team1_id: string;
    team2_id: string;
  }>(
    `SELECT o.short_side, o.decided, m.team1_id, m.team2_id
       FROM match_walkover_offers o JOIN matches m ON m.slug = o.match_slug WHERE o.match_slug = ?`,
    [slug]
  );
  if (!row || row.decided) throw new SignupError(409, 'There is nothing to choose.', 'no_offer');
  await requireCaptain(row.short_side === 'team1' ? row.team2_id : row.team1_id, uid);
  await decideWalkover(slug, take, uid);
}

/**
 * `.walkover` / `.play` in game (cs2 chatBridge): the player's account, then
 * the same choice as the match page. What to say back in game, or null when
 * there is nothing to choose (any other chat line).
 */
export async function chooseWalkoverInGame(
  slug: string,
  steamId: string,
  take: boolean
): Promise<string | null> {
  const open = await db.queryOneAsync<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM match_walkover_offers WHERE match_slug = ? AND decided IS NULL',
    [slug]
  );
  if (!open?.n) return null;
  const player = await db.queryOneAsync<{ uid: string | null }>(
    'SELECT uid FROM players WHERE id = ?',
    [steamId]
  );
  if (!player?.uid) return "Only the full team's owner or a captain can choose.";
  try {
    await chooseWalkover(slug, player.uid, take);
    return take ? 'Walkover taken. The match is over.' : 'Playing them short.';
  } catch (error) {
    if (error instanceof SignupError) return "Only the full team's owner or a captain can choose.";
    throw error;
  }
}

/** The match config's players on one side (steam id → name). */
export function rosterOf(config: string | null, side: 'team1' | 'team2'): Array<[string, string]> {
  try {
    const c = JSON.parse(config ?? '{}') as Partial<
      Record<string, { players?: Record<string, Untrusted> }>
    >;
    return Object.entries(c[side]?.players ?? {}).map(([id, name]) => [id, String(name)]);
  } catch {
    return [];
  }
}

export interface FullTeamState {
  /** Unix seconds; while the match is loaded and the timer is on. */
  deadline: number | null;
  size: number;
  teams: Array<{
    side: 'team1' | 'team2';
    teamId: string | null;
    name: string;
    players: Array<{ steamId: string; name: string; sub: boolean; onServer: boolean }>;
    /** Starters a sub replaced (check-in). */
    out: string[];
  }>;
  offer: { shortSide: string; expiresAt: number; decided: string | null } | null;
}

/** The match room's view: the deadline while loaded, who is on the server, and the choice. */
export async function fullTeamState(slug: string): Promise<FullTeamState | null> {
  const row = await db.queryOneAsync<{
    status: string;
    load_id: number | null;
    loaded_at: number | null;
    config: string | null;
    team1_id: string | null;
    team2_id: string | null;
    tournament_id: number;
    settings: string | null;
  }>(
    `SELECT m.status, m.loaded_at AS load_id, GREATEST(m.loaded_at, COALESCE(m.countdown_from, 0)) AS loaded_at, m.config,
            m.team1_id, m.team2_id, m.tournament_id, t.settings
       FROM matches m JOIN tournament t ON t.id = m.tournament_id WHERE m.slug = ?`,
    [slug]
  );
  if (!row) return null;
  const offer = await db.queryOneAsync<{
    short_side: string;
    expires_at: number;
    decided: string | null;
  }>(
    'SELECT short_side, expires_at, decided FROM match_walkover_offers WHERE match_slug = ? AND loaded_at = ?',
    [slug, row.load_id]
  );
  const minutes = botsPlay(row.config) ? 0 : fullTeamMinutesOf(row.settings);
  const deadline =
    row.status === 'loaded' && row.loaded_at && minutes > 0
      ? Number(row.loaded_at) + minutes * 60
      : null;
  if (!deadline && !offer) return null;
  const config = JSON.parse(row.config ?? '{}') as {
    players_per_team?: Untrusted;
    team1?: { name?: Untrusted };
    team2?: { name?: Untrusted };
  };
  const regs = await tournamentSignupService.registrations(row.tournament_id).catch(() => []);
  const teams = (['team1', 'team2'] as const).map((side) => {
    const teamId = side === 'team1' ? row.team1_id : row.team2_id;
    const lineup = regs.find((r) => r.teamId === teamId)?.lineup ?? [];
    const roster = rosterOf(row.config, side);
    const ids = new Set(roster.map(([id]) => id));
    return {
      side,
      teamId,
      name: String(config[side]?.name ?? side),
      players: roster.map(([steamId, name]) => ({
        steamId,
        name,
        sub: lineup.some((p) => p.steamId === steamId && p.role === 'sub'),
        onServer: playerConnectionService.connectionOf(slug, steamId).state === 'connected',
      })),
      out: lineup.filter((p) => p.role === 'starter' && !ids.has(p.steamId)).map((p) => p.name),
    };
  });
  return {
    deadline,
    size: Number(config.players_per_team) || 5,
    teams,
    offer: offer
      ? { shortSide: offer.short_side, expiresAt: Number(offer.expires_at), decided: offer.decided }
      : null,
  };
}
