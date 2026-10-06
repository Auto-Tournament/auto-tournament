/**
 * The extra numbers of a Ready Up map result (`event.map_result` stats), kept
 * per player per map in `cs2_player_map_stats`: openings, clutches,
 * multi-kills, flashes on teammates and rounds per side. `player_match_stats`
 * keeps the core totals; these feed the profile's Sides and Impact blocks,
 * the rating and the results awards (../routes/playerProfile.ts,
 * ../tournamentExtras.ts).
 *
 * A plugin (MatchZy Enhanced) server sends none of this, so its matches have
 * no rows and those blocks show dashes.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { isDevBotId } from './normalize';
import type { MapStats } from './protocol/v1';

/**
 * Save a map's stats. `mapNumber` is the platform's (0-based). Dev bots are
 * left out unless the match is a simulation. Never throws: a failure here
 * must not stop the result from being applied.
 */
export async function saveMapStats(
  slug: string,
  mapNumber: number,
  mapName: string | null,
  stats: MapStats | undefined,
  { includeBots = false }: { includeBots?: boolean } = {}
): Promise<void> {
  if (!stats?.players?.length) return;
  try {
    for (const line of stats.players) {
      if (line.team !== 1 && line.team !== 2) continue;
      if (!includeBots && (line.bot || isDevBotId(line.id))) continue;
      const s = line.stats;
      const multi = s.multi_kills ?? [];
      // Rounds per side from the round summaries: the side the player was on
      // that round, and whether that side won it.
      let ct = 0;
      let ctWon = 0;
      let tr = 0;
      let tWon = 0;
      for (const round of stats.rounds ?? []) {
        const me = round.players.find((p) => p.id === line.id);
        if (!me) continue;
        if (me.side === 3) {
          ct += 1;
          if (round.winner_side === 3) ctWon += 1;
        } else if (me.side === 2) {
          tr += 1;
          if (round.winner_side === 2) tWon += 1;
        }
      }
      const row = {
        team: line.team === 1 ? 'team1' : 'team2',
        map_name: mapName,
        rounds_played: s.rounds_played ?? 0,
        kills: s.kills ?? 0,
        deaths: s.deaths ?? 0,
        assists: s.assists ?? 0,
        damage: s.damage ?? 0,
        headshot_kills: s.headshot_kills ?? 0,
        kast_rounds: s.kast_rounds ?? 0,
        entry_kills: (s.entry_kills_t ?? 0) + (s.entry_kills_ct ?? 0),
        entry_deaths: (s.entry_deaths_t ?? 0) + (s.entry_deaths_ct ?? 0),
        trade_kills: s.trade_kills ?? 0,
        clutches_won: (s.clutches_won ?? []).reduce((a, b) => a + (b ?? 0), 0),
        enemies_flashed: s.enemies_flashed ?? 0,
        friendlies_flashed: s.friendlies_flashed ?? 0,
        multi_1k: multi[0] ?? 0,
        multi_2k: multi[1] ?? 0,
        multi_3k: multi[2] ?? 0,
        multi_4k: multi[3] ?? 0,
        multi_5k: multi[4] ?? 0,
        ct_rounds: ct,
        ct_rounds_won: ctWon,
        t_rounds: tr,
        t_rounds_won: tWon,
      };
      const cols = Object.keys(row);
      await db.runAsync(
        `INSERT INTO cs2_player_map_stats (match_slug, map_number, player_id, ${cols.join(', ')})
         VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})
         ON CONFLICT (match_slug, map_number, player_id) DO UPDATE SET
           ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        [slug, mapNumber, line.id, ...Object.values(row)]
      );
    }
  } catch (error) {
    log.warn(`[FLEET] Could not save map stats for ${slug} map ${mapNumber}`, {
      error: (error as Error).message,
    });
  }
}
