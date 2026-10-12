/**
 * A CS2 player's role: the one they chose (kept as they set it), and a
 * suggestion from how they played in the analysed demos. The suggestion is
 * left out when there is too little to go on; analysis never changes a
 * chosen role. An in-game leader is never suggested: calling is not in the
 * demos.
 *
 * Signals, each per player over their analysed maps:
 *   AWP share       kills with the AWP / all kills
 *   opening rate    opening duels taken (kill or death) per round; a team
 *                   has one a round, so 0.20 is a fifth, the average
 *   utility         enemies flashed and utility damage per round
 *
 * Roles, first that fits: AWPer (AWP share ≥ 25 %), entry (opening rate
 * ≥ 0.27), support (≥ 0.5 enemies flashed or ≥ 8 utility damage a round),
 * else rifler. Checked against 23 pro and NTLAN players' demos (2026-10-12):
 * the AWPers and entries came out as they play. A lurker is not suggested:
 * neither when in the round a player's kills come nor how late in the kill
 * order told known lurkers apart (AWPers scored as late), and positions are
 * only known at kills. Players can still choose it.
 */

import { db } from '../../config/database';

export const ROLES = ['rifler', 'awper', 'igl', 'entry', 'support', 'lurker'] as const;
export type Role = (typeof ROLES)[number];
/** The roles analysis can suggest (never igl or lurker). */
export type SuggestedRole = Exclude<Role, 'igl' | 'lurker'>;

export const MIN_MAPS = 3;
export const MIN_KILLS = 30;

export interface RoleEvidence {
  maps: number;
  rounds: number;
  kills: number;
  awpShare: number;
  openingRate: number;
  flashesPerRound: number;
  utilityPerRound: number;
}

export interface RoleSuggestion {
  role: SuggestedRole;
  /** How sure: by the number of maps and how clearly the signal stands out. */
  confidence: 'low' | 'medium' | 'high';
  evidence: RoleEvidence;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The suggestion for this evidence, or null when there is too little of it. */
export function suggestRole(e: RoleEvidence): RoleSuggestion | null {
  if (e.maps < MIN_MAPS || e.kills < MIN_KILLS || e.rounds <= 0) return null;
  let role: SuggestedRole;
  let margin: number; // how far past its threshold, 0–1
  if (e.awpShare >= 0.25) {
    role = 'awper';
    margin = Math.min(1, (e.awpShare - 0.25) / 0.25);
  } else if (e.openingRate >= 0.27) {
    role = 'entry';
    margin = Math.min(1, (e.openingRate - 0.27) / 0.1);
  } else if (e.flashesPerRound >= 0.5 || e.utilityPerRound >= 8) {
    role = 'support';
    margin = Math.min(1, Math.max((e.flashesPerRound - 0.5) / 0.4, (e.utilityPerRound - 8) / 6));
  } else {
    role = 'rifler';
    margin = 0.5;
  }
  const confidence =
    e.maps >= 12 && margin >= 0.3 ? 'high' : e.maps >= 6 && margin >= 0.15 ? 'medium' : 'low';
  return { role, confidence, evidence: e };
}

interface KillInfo {
  attacker: string | null;
  weapon: string;
}

/** The players' evidence from every analysed map they played. */
export async function roleEvidence(playerIds: string[]): Promise<Map<string, RoleEvidence>> {
  const out = new Map<string, RoleEvidence>();
  if (playerIds.length === 0) return out;
  const marks = playerIds.map(() => '?').join(', ');
  const stats = await db.queryAsync<{
    player_id: string;
    match_slug: string;
    map_number: number;
    rounds_played: number;
    kills: number;
    entry_kills: number;
    entry_deaths: number;
    enemies_flashed: number;
    utility_damage: number;
  }>(
    `SELECT player_id, match_slug, map_number, rounds_played, kills, entry_kills, entry_deaths,
            enemies_flashed, utility_damage
       FROM cs2_player_map_stats WHERE demo_analyzed = 1 AND player_id IN (${marks})`,
    playerIds
  );
  const maps = [...new Set(stats.map((s) => `${s.match_slug}|${s.map_number}`))];
  const jobs = maps.length
    ? await db.queryAsync<{
        match_slug: string;
        map_number: number;
        kills: string | null;
        rounds: string | null;
      }>(
        `SELECT match_slug, map_number, kills FROM cs2_demo_jobs
          WHERE (match_slug || '|' || map_number::text) IN (${maps.map(() => '?').join(', ')})`,
        maps
      )
    : [];
  // Per player: AWP kills from the kill lists.
  const awp = new Map<string, number>();
  const listed = new Map<string, number>();
  for (const job of jobs) {
    let kills: KillInfo[] = [];
    try {
      kills = JSON.parse(job.kills ?? '[]') as KillInfo[];
    } catch {
      continue;
    }
    for (const k of kills) {
      if (!k.attacker || !playerIds.includes(k.attacker)) continue;
      listed.set(k.attacker, (listed.get(k.attacker) ?? 0) + 1);
      if (/^awp$/i.test(k.weapon)) awp.set(k.attacker, (awp.get(k.attacker) ?? 0) + 1);
    }
  }
  for (const id of playerIds) {
    const mine = stats.filter((s) => s.player_id === id);
    if (mine.length === 0) continue;
    const sum = (k: keyof (typeof mine)[number]) =>
      mine.reduce((a, s) => a + (Number(s[k]) || 0), 0);
    const rounds = sum('rounds_played');
    const kills = sum('kills');
    const fromList = listed.get(id) ?? 0;
    out.set(id, {
      maps: mine.length,
      rounds,
      kills,
      awpShare: fromList ? r2((awp.get(id) ?? 0) / fromList) : 0,
      openingRate: rounds ? r2((sum('entry_kills') + sum('entry_deaths')) / rounds) : 0,
      flashesPerRound: rounds ? r2(sum('enemies_flashed') / rounds) : 0,
      utilityPerRound: rounds ? Math.round((sum('utility_damage') / rounds) * 10) / 10 : 0,
    });
  }
  return out;
}

/** The roles the players chose themselves. */
export async function chosenRoles(playerIds: string[]): Promise<Map<string, Role>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db.queryAsync<{ player_id: string; role: Role }>(
    `SELECT player_id, role FROM cs2_player_roles WHERE player_id IN (${playerIds.map(() => '?').join(', ')})`,
    playerIds
  );
  return new Map(rows.map((r) => [r.player_id, r.role]));
}

export async function chooseRole(playerId: string, role: Role | null): Promise<void> {
  if (role === null) {
    await db.runAsync('DELETE FROM cs2_player_roles WHERE player_id = ?', [playerId]);
    return;
  }
  await db.runAsync(
    `INSERT INTO cs2_player_roles (player_id, role, updated_at) VALUES (?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
     ON CONFLICT (player_id) DO UPDATE SET role = EXCLUDED.role, updated_at = EXCLUDED.updated_at`,
    [playerId, role]
  );
}

/** Each player's chosen role and suggestion. */
export async function rolesOf(
  playerIds: string[]
): Promise<Record<string, { chosen: Role | null; suggestion: RoleSuggestion | null }>> {
  const [chosen, evidence] = await Promise.all([chosenRoles(playerIds), roleEvidence(playerIds)]);
  return Object.fromEntries(
    playerIds.map((id) => {
      const e = evidence.get(id);
      return [id, { chosen: chosen.get(id) ?? null, suggestion: e ? suggestRole(e) : null }];
    })
  );
}
