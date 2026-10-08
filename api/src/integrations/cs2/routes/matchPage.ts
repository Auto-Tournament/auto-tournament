/**
 * What a finished match's public page shows from CS2 (client: the match
 * page's `matchPanels.publicView`): the scoreboard over every map, and the
 * match's highlight clips.
 *
 * Public:
 *   GET /api/game/cs2/matches/:slug/scoreboard   each team's players over the whole match (and per map)
 *   GET /api/game/cs2/matches/:slug/highlights   the match's finished clips, in match order
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

const router = Router();

interface StatRow {
  player_id: string;
  team: 'team1' | 'team2';
  map_number: number;
  name: string | null;
  avatar_url: string | null;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshot_kills: number;
  kast_rounds: number;
  entry_kills: number;
  multi_3k: number;
  multi_4k: number;
  multi_5k: number;
}

export interface ScoreboardLine {
  playerId: string;
  name: string;
  avatar: string | null;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Average damage per round. */
  adr: number;
  /** Share of kills that were headshots, 0–100. */
  hsPercent: number;
  /** Rounds with a kill, assist, survival or trade, 0–100. */
  kast: number;
  entryKills: number;
  /** Rounds with 3 kills or more. */
  multiKills: number;
}

const num = (v: unknown) => Number(v) || 0;

function line(rows: StatRow[]): ScoreboardLine {
  const sum = (k: keyof StatRow) => rows.reduce((s, r) => s + num(r[k]), 0);
  const rounds = sum('rounds_played');
  const kills = sum('kills');
  return {
    playerId: rows[0]!.player_id,
    name: rows[0]!.name ?? rows[0]!.player_id,
    avatar: rows[0]!.avatar_url,
    rounds,
    kills,
    deaths: sum('deaths'),
    assists: sum('assists'),
    adr: rounds ? Math.round((sum('damage') / rounds) * 10) / 10 : 0,
    hsPercent: kills ? Math.round((100 * sum('headshot_kills')) / kills) : 0,
    kast: rounds ? Math.round((100 * sum('kast_rounds')) / rounds) : 0,
    entryKills: sum('entry_kills'),
    multiKills: sum('multi_3k') + sum('multi_4k') + sum('multi_5k'),
  };
}

/** Each team's lines, best first (by damage per round). */
function teams(rows: StatRow[]): { team1: ScoreboardLine[]; team2: ScoreboardLine[] } {
  const by = new Map<string, StatRow[]>();
  for (const r of rows)
    by.set(`${r.team}:${r.player_id}`, [...(by.get(`${r.team}:${r.player_id}`) ?? []), r]);
  const out = { team1: [] as ScoreboardLine[], team2: [] as ScoreboardLine[] };
  for (const [key, list] of by) out[key.startsWith('team1') ? 'team1' : 'team2'].push(line(list));
  out.team1.sort((a, b) => b.adr - a.adr);
  out.team2.sort((a, b) => b.adr - a.adr);
  return out;
}

router.get('/matches/:slug/scoreboard', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAsync<StatRow>(
      `SELECT s.player_id, s.team, s.map_number, p.name, p.avatar_url, s.rounds_played, s.kills, s.deaths,
              s.assists, s.damage, s.headshot_kills, s.kast_rounds, s.entry_kills, s.multi_3k, s.multi_4k, s.multi_5k
         FROM cs2_player_map_stats s LEFT JOIN players p ON p.id = s.player_id
        WHERE s.match_slug = ?
        ORDER BY s.map_number`,
      [req.params.slug]
    );
    const maps = [...new Set(rows.map((r) => Number(r.map_number)))].map((mapNumber) => ({
      mapNumber,
      ...teams(rows.filter((r) => Number(r.map_number) === mapNumber)),
    }));
    return res.json({ success: true, ...teams(rows), maps });
  } catch (error) {
    log.error('[MATCH PAGE] scoreboard failed', { error, slug: req.params.slug });
    return res.status(500).json({ success: false, error: 'Could not read the scoreboard' });
  }
});

router.get('/matches/:slug/highlights', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAsync<{
      id: number;
      player_id: string;
      name: string | null;
      avatar_url: string | null;
      kind: string;
      title: string;
      round: number;
      map_number: number;
      map_name: string | null;
    }>(
      `SELECT h.id, h.player_id, p.name, p.avatar_url, h.kind, h.title, h.round, h.map_number,
              (SELECT j.map_name FROM cs2_demo_jobs j WHERE j.match_slug = h.match_slug AND j.map_number = h.map_number) AS map_name
         FROM cs2_highlights h LEFT JOIN players p ON p.id = h.player_id
        WHERE h.match_slug = ? AND h.status = 'done' AND h.kind <> 'funny'
        ORDER BY h.map_number, h.start_tick`,
      [req.params.slug]
    );
    return res.json({
      success: true,
      clips: rows.map((r) => ({
        id: Number(r.id),
        playerId: r.player_id,
        playerName: r.name ?? r.player_id,
        avatar: r.avatar_url,
        kind: r.kind,
        title: r.title,
        round: Number(r.round),
        mapNumber: Number(r.map_number),
        map: r.map_name,
        video: `/api/game/cs2/highlights/${Number(r.id)}.mp4`,
      })),
    });
  } catch (error) {
    log.error('[MATCH PAGE] highlights failed', { error, slug: req.params.slug });
    return res.status(500).json({ success: false, error: 'Could not read the highlights' });
  }
});

export default router;
