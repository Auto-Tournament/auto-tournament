import { db } from '../config/database';
import { log } from '../utils/logger';

export type WinnerTeam = 'team1' | 'team2' | 'none' | null;

export interface MatchMapResultRecord {
  matchSlug: string;
  mapNumber: number;
  mapName?: string | null;
  team1Score: number;
  team2Score: number;
  winnerTeam: WinnerTeam;
  demoFilePath?: string | null;
  completedAt: number;
}

const UPSERT_SQL = `
  INSERT INTO match_map_results (
    match_slug,
    map_number,
    map_name,
    team1_score,
    team2_score,
    winner_team,
    demo_file_path,
    completed_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(match_slug, map_number)
  DO UPDATE SET
    map_name = excluded.map_name,
    team1_score = excluded.team1_score,
    team2_score = excluded.team2_score,
    winner_team = excluded.winner_team,
    demo_file_path = COALESCE(excluded.demo_file_path, match_map_results.demo_file_path),
    completed_at = excluded.completed_at
`;

export async function recordMapResult(params: {
  matchSlug: string;
  mapNumber: number | null | undefined;
  mapName?: string | null;
  team1Score?: number | null;
  team2Score?: number | null;
  winnerTeam?: WinnerTeam;
  completedAt?: number;
}): Promise<void> {
  const { matchSlug, mapNumber } = params;

  if (!matchSlug || typeof mapNumber !== 'number' || Number.isNaN(mapNumber)) {
    return;
  }

  const payload = {
    matchSlug,
    mapNumber,
    mapName: params.mapName ?? null,
    team1Score: typeof params.team1Score === 'number' ? params.team1Score : 0,
    team2Score: typeof params.team2Score === 'number' ? params.team2Score : 0,
    winnerTeam: params.winnerTeam ?? null,
    completedAt: params.completedAt ?? Math.floor(Date.now() / 1000),
  };

  try {
    await db.runAsync(UPSERT_SQL, [
      payload.matchSlug,
      payload.mapNumber,
      payload.mapName,
      payload.team1Score,
      payload.team2Score,
      payload.winnerTeam,
      null, // demo_file_path - will be set when demo is uploaded
      payload.completedAt,
    ]);
    log.debug('[MatchMapResults] Stored map result', payload);
  } catch (error) {
    log.error('[MatchMapResults] Failed to store map result', {
      error,
      payload,
    });
  }
}

export async function getMapResults(matchSlug: string): Promise<MatchMapResultRecord[]> {
  const rows = await db.queryAsync<{
    map_number: number;
    map_name?: string | null;
    team1_score: number;
    team2_score: number;
    winner_team?: string | null;
    demo_file_path?: string | null;
    completed_at: number;
  }>(
    `SELECT map_number, map_name, team1_score, team2_score, winner_team, demo_file_path, completed_at
     FROM match_map_results
     WHERE match_slug = ?
     ORDER BY map_number ASC`,
    [matchSlug]
  );

  return rows.map((row) => ({
    matchSlug,
    mapNumber: row.map_number,
    mapName: row.map_name ?? null,
    team1Score: row.team1_score ?? 0,
    team2Score: row.team2_score ?? 0,
    winnerTeam: (row.winner_team as WinnerTeam) ?? null,
    demoFilePath: row.demo_file_path ?? null,
    completedAt: row.completed_at,
  }));
}

export async function clearMapResults(matchSlug: string): Promise<void> {
  try {
    await db.runAsync('DELETE FROM match_map_results WHERE match_slug = ?', [matchSlug]);
  } catch (error) {
    log.error('[MatchMapResults] Failed to clear map results', { error, matchSlug });
  }
}
