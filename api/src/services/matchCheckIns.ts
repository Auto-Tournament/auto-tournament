/**
 * Check-in before each match (settings.checkInEachMatch; Claude Design, the
 * match room). From the match's veto opening until it starts, its starters say
 * they're here, or a captain does it for them (settings.captainCheckIn). Subs
 * are always ready. At the start a starter who didn't check in is swapped for
 * a sub (services/checkInSwap.ts).
 */

import { db } from '../config/database';
import { matchTimesOf, startOfMatch, vetoOpensOf } from './matchTimes';
import {
  SignupError,
  requireCaptain,
  tournamentSignupService,
  windowOfSettings,
} from './tournamentSignupService';
import { emitMatchUpdate } from './socketService';
import type { Untrusted } from '../utils/untrusted';

interface MatchRow {
  slug: string;
  tournament_id: number | null;
  round: number | null;
  status: string;
  team1_id: string | null;
  team2_id: string | null;
  starts_at?: number | null;
}

export interface MatchCheckInTeam {
  teamId: string;
  name: string;
  players: Array<{ steamId: string; name: string; role: 'starter' | 'sub'; checkedIn: boolean }>;
}

export interface MatchCheckInState {
  /** Starters can check in now. */
  open: boolean;
  /** When it closes: the match's start (epoch s), null without a time. */
  closesAt: number | null;
  teams: MatchCheckInTeam[];
}

async function matchAndSettings(slug: string) {
  const match = await db.queryOneAsync<MatchRow>(
    'SELECT slug, tournament_id, round, status, team1_id, team2_id, starts_at FROM matches WHERE slug = ?',
    [slug]
  );
  if (!match?.tournament_id) return null;
  const t = await db.queryOneAsync<{ settings: string | null }>(
    'SELECT settings FROM tournament WHERE id = ?',
    [match.tournament_id]
  );
  let settings: Record<string, Untrusted> = {};
  try {
    settings = t?.settings ? (JSON.parse(t.settings) as Record<string, Untrusted>) : {};
  } catch {
    settings = {};
  }
  return { match, settings, raw: t?.settings ?? null };
}

/** Open now (pure): switched on, from the veto opening (or right away without a time) until the start. */
export function checkInOpen(
  on: boolean,
  status: string,
  opensAt: number | null,
  closesAt: number | null,
  nowS: number
): boolean {
  if (!on || !['pending', 'ready', 'loaded'].includes(status)) return false;
  if (opensAt !== null && nowS < opensAt) return false;
  return closesAt === null || nowS < closesAt;
}

export async function matchCheckInState(slug: string): Promise<MatchCheckInState | null> {
  const found = await matchAndSettings(slug);
  if (found?.settings.checkInEachMatch !== true) return null;
  const { match, settings } = found;
  const times = matchTimesOf(settings);
  const start = startOfMatch(match, times);
  const opens = vetoOpensOf(start, times);
  const regs = await tournamentSignupService.registrations(match.tournament_id as number);
  const checked = new Set(
    (
      await db.queryAsync<{ player_id: string }>(
        'SELECT player_id FROM match_checkins WHERE match_slug = ?',
        [slug]
      )
    ).map((r) => r.player_id)
  );
  const teams = [match.team1_id, match.team2_id]
    .map((id) => regs.find((r) => r.teamId === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      teamId: r.teamId,
      name: r.teamName,
      players: r.lineup.map((p) => ({
        steamId: p.steamId,
        name: p.name,
        role: p.role,
        // Subs are always ready.
        checkedIn: p.role === 'sub' || checked.has(p.steamId),
      })),
    }));
  return {
    open: checkInOpen(true, match.status, opens, start, Math.floor(Date.now() / 1000)),
    closesAt: start,
    teams,
  };
}

/** A starter checks in for the match; with `by`, their team's owner or a captain does. */
export async function checkInForMatch(
  slug: string,
  steamId: string,
  by?: { uid: string; teamId: string }
): Promise<void> {
  const found = await matchAndSettings(slug);
  if (!found) throw new SignupError(404, 'No such match.');
  const state = await matchCheckInState(slug);
  if (!state) throw new SignupError(409, 'This tournament checks in once, not per match.', 'off');
  if (!state.open) throw new SignupError(409, 'Check-in for this match is not open.', 'closed');
  const team = state.teams.find((t) => t.players.some((p) => p.steamId === steamId));
  if (!team) throw new SignupError(403, 'Not in a lineup for this match.', 'not_in_lineup');
  if (by) {
    if (!windowOfSettings(found.raw).captainCheckIn)
      throw new SignupError(403, 'Players check in themselves here.', 'self_only');
    if (by.teamId !== team.teamId)
      throw new SignupError(403, 'That player is not in your lineup.', 'not_in_lineup');
    await requireCaptain(by.teamId, by.uid);
  }
  await db.runAsync(
    `INSERT INTO match_checkins (match_slug, player_id, checked_in_by) VALUES (?, ?, ?)
     ON CONFLICT (match_slug, player_id) DO NOTHING`,
    [slug, steamId, by?.uid ?? null]
  );
  emitMatchUpdate({ slug, lineup: true });
}

/** The match's starters who didn't check in, once its check-in has closed (none before). */
export async function absentForMatch(
  slug: string,
  starters: readonly string[]
): Promise<Set<string>> {
  const state = await matchCheckInState(slug);
  if (!state || state.open) return new Set();
  const here = new Set(
    state.teams.flatMap((t) => t.players.filter((p) => p.checkedIn).map((p) => p.steamId))
  );
  return new Set(starters.filter((id) => !here.has(id)));
}
