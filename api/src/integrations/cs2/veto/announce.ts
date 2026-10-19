/**
 * A match's veto just opened (both teams known): nobody may miss it. The team
 * whose turn it is gets the "your turn" notice (bell, Discord DM, email, as
 * each player chose), and every player of both teams still on a server
 * (their last match's, in postgame) is told in game where to go.
 */
import { db } from '../../../config/database';
import type { DbMatchRow } from '../../../types/database.types';
import { log } from '../../../utils/logger';
import { announceVetoTurn } from '../../../services/matchNotices';
import { playerConnectionService } from '../../../services/playerConnectionService';
import { sayInGame } from '../fleet/gameMessages';

/** `opensAt` (unix s): the veto waits for the break; players are told when it opens instead. */
export async function announceVetoOpen(slug: string, opensAt?: number): Promise<void> {
  try {
    const match = await db.queryOneAsync<{
      slug: string;
      team1_id: string | null;
      team2_id: string | null;
      t1: string | null;
      t2: string | null;
      p1: string | null;
      p2: string | null;
    }>(
      `SELECT m.slug, m.team1_id, m.team2_id, t1.name AS t1, t2.name AS t2, t1.players AS p1, t2.players AS p2
         FROM matches m LEFT JOIN teams t1 ON t1.id = m.team1_id LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE m.slug = ?`,
      [slug]
    );
    if (!match?.team1_id || !match.team2_id) return;

    const { resolveCurrentVetoTurn } = await import('./context');
    const full = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    const turn = full ? await resolveCurrentVetoTurn(full) : null;
    if (!opensAt && (turn?.currentTurn === 'team1' || turn?.currentTurn === 'team2')) {
      await announceVetoTurn(slug, turn.currentTurn, 1, String(turn.currentAction ?? 'ban'));
      // The match chat says the veto is on too (once per match).
      const { postVetoStarted } = await import('./chatLines');
      await postVetoStarted(slug, turn.currentTurn, String(turn.currentAction ?? 'ban'));
    }

    const players = new Set<string>();
    for (const raw of [match.p1, match.p2]) {
      try {
        for (const pl of JSON.parse(raw ?? '[]') as Array<{ steamId?: string; steamid?: string }>) {
          const id = pl.steamId ?? pl.steamid;
          if (id) players.add(id);
        }
      } catch {
        // a team without a readable roster tells nobody in game
      }
    }
    if (players.size === 0) return;
    // Servers that still hold one of these players (the match they just played).
    const recent = await db.queryAsync<{ slug: string; server_id: string }>(
      `SELECT slug, server_id FROM matches
        WHERE server_id IS NOT NULL AND server_id <> '' AND slug <> ?
          AND status IN ('loaded', 'live', 'completed')
          AND COALESCE(completed_at, EXTRACT(EPOCH FROM NOW())::int) > EXTRACT(EPOCH FROM NOW())::int - 1800`,
      [slug]
    );
    const base = (process.env.FRONTEND_BASE_URL || '').replace(/\/+$/, '');
    const url = `${base}/match/${encodeURIComponent(slug)}`;
    const name = `${match.t1 ?? 'Team 1'} vs ${match.t2 ?? 'Team 2'}`;
    for (const row of recent) {
      for (const p of playerConnectionService.getStatus(row.slug)?.connectedPlayers ?? []) {
        if (players.has(p.steamId)) {
          void sayInGame(
            row.server_id,
            opensAt ? 'nextMatchSoon' : 'nextMatchReady',
            {
              name,
              url,
              minutes: opensAt
                ? Math.max(1, Math.round((opensAt * 1000 - Date.now()) / 60000))
                : undefined,
            },
            { to: p.steamId }
          );
        }
      }
    }
  } catch (error) {
    log.warn(`[VETO] Could not announce the open veto of ${slug}`, {
      error: (error as Error).message,
    });
  }
}
