/**
 * "Your match is ready" and "your turn in the veto": a bell notice and, where
 * a player has them on, a Discord DM or an email (notifyChannels). Each goes
 * out once per match load and veto step.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { notificationService } from './notificationService';
import { notifyChannels } from './notifyChannels';

interface MatchRow {
  slug: string;
  tournament_id: number | null;
  team1_id: string | null;
  team2_id: string | null;
  config: string | null;
  loaded_at: number | null;
  t1: string | null;
  t2: string | null;
}

async function matchRow(slug: string): Promise<MatchRow | null> {
  const row = await db.queryOneAsync<MatchRow>(
    `SELECT m.slug, m.tournament_id, m.team1_id, m.team2_id, m.config, m.loaded_at,
            t1.name AS t1, t2.name AS t2
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.slug = ?`,
    [slug]
  );
  return row ?? null;
}

/** A side's players: the match's own lineup (no bots), else its team's members. */
async function sidePlayers(match: MatchRow, side: 'team1' | 'team2'): Promise<string[]> {
  try {
    const config = JSON.parse(match.config ?? '{}') as Record<
      string,
      { players?: Record<string, string> } | undefined
    >;
    const ids = Object.keys(config[side]?.players ?? {}).filter((id) => /^\d{17}$/.test(id));
    if (ids.length) return ids;
  } catch {
    // No stored config: the team's members below.
  }
  const teamId = side === 'team1' ? match.team1_id : match.team2_id;
  if (!teamId) return [];
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT p.id FROM team_members m JOIN players p ON p.uid::text = m.account_uid::text WHERE m.team_id = ?`,
    [teamId]
  );
  return rows.map((r) => r.id);
}

/** A team's captains, else everyone on it: who makes its veto picks. */
async function captainsOf(teamId: string | null): Promise<string[]> {
  if (!teamId) return [];
  const rows = await db.queryAsync<{ id: string; role: string }>(
    `SELECT p.id, m.role FROM team_members m JOIN players p ON p.uid::text = m.account_uid::text WHERE m.team_id = ?`,
    [teamId]
  );
  const captains = rows.filter((r) => r.role === 'captain').map((r) => r.id);
  return captains.length ? captains : rows.map((r) => r.id);
}

const nameOf = (m: MatchRow) => `${m.t1 ?? 'TBD'} vs ${m.t2 ?? 'TBD'}`;

/** The server has the match: both teams can connect. */
export async function announceMatchReady(slug: string): Promise<void> {
  try {
    const match = await matchRow(slug);
    if (!match) return;
    const players = [
      ...(await sidePlayers(match, 'team1')),
      ...(await sidePlayers(match, 'team2')),
    ];
    if (!players.length) return;
    // A reload of the same match (failover, restart) is a new "ready".
    const key = `match:${slug}:ready:${match.loaded_at ?? 0}`;
    const name = nameOf(match);
    await notificationService.notifyOnce(
      players,
      'tournament',
      { event: 'match_ready', matchSlug: slug, name, tournamentId: match.tournament_id },
      key
    );
    await notifyChannels.deliver(players, 'match_ready', key, {
      subject: `Your match is ready: ${name}`,
      text: 'The server is up. Open the match room for the connect link.',
      url: `/match/${encodeURIComponent(slug)}`,
      action: 'Open the match room',
    });
  } catch (error) {
    log.warn(`[NOTIFY] Could not announce ${slug} as ready`, { error });
  }
}

/** It is a team's turn in the veto (`step`, from 1): its captains are told. */
export async function announceVetoTurn(
  slug: string,
  side: 'team1' | 'team2',
  step: number,
  action: string
): Promise<void> {
  try {
    const match = await matchRow(slug);
    if (!match) return;
    const players = await captainsOf(side === 'team1' ? match.team1_id : match.team2_id);
    if (!players.length) return;
    const key = `match:${slug}:veto:${step}`;
    const name = nameOf(match);
    const verb =
      action === 'pick' ? 'pick a map' : action === 'side_pick' ? 'pick a side' : 'ban a map';
    await notificationService.notifyOnce(
      players,
      'tournament',
      { event: 'veto_turn', matchSlug: slug, name, action, tournamentId: match.tournament_id },
      key
    );
    await notifyChannels.deliver(players, 'veto_turn', key, {
      subject: `Your turn in the veto: ${name}`,
      text: `It is your team's turn to ${verb}.`,
      url: `/match/${encodeURIComponent(slug)}`,
      action: 'Go to the veto',
    });
  } catch (error) {
    log.warn(`[NOTIFY] Could not announce the veto turn of ${slug}`, { error });
  }
}
