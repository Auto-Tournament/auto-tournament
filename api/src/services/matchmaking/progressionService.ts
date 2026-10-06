/**
 * XP, levels, commends and the post-match screen for matchmaking matches
 * (docs/design/matchmaking.md, "After the match"). XP is a ledger
 * (`xp_events`); `player_progress` caches each player's total.
 */
import { rating as osRating } from 'openskill';
import { db } from '../../config/database';
import { openSkillToDisplayElo } from '../../utils/ratingMath';
import { log } from '../../utils/logger';
import {
  COMMEND_WINDOW_SECONDS,
  levelFor,
  parseCommend,
  xpForMatch,
  type XpReason,
} from './progression';

export class ProgressionError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

const now = () => Math.floor(Date.now() / 1000);
const startOfUtcDay = (t: number) => t - (t % 86400);

interface LobbyPlayer {
  player_id: string;
  team: number;
}

async function lobbyPlayersOfMatch(matchSlug: string): Promise<LobbyPlayer[]> {
  return db.queryAsync<LobbyPlayer>(
    `SELECT lp.player_id, lp.team FROM mm_lobby_players lp
       JOIN mm_lobbies l ON l.id = lp.lobby_id
      WHERE l.match_slug = ?`,
    [matchSlug]
  );
}

async function addXp(playerId: string, matchSlug: string | null, amount: number, reason: XpReason, note?: string): Promise<boolean> {
  const res = await db.runAsync(
    `INSERT INTO xp_events (player_id, match_slug, amount, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [playerId, matchSlug, amount, reason, note ?? null, now()]
  );
  if (!res.changes) return false;
  await db.runAsync(
    `INSERT INTO player_progress (player_id, total_xp, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (player_id) DO UPDATE SET total_xp = player_progress.total_xp + EXCLUDED.total_xp, updated_at = EXCLUDED.updated_at`,
    [playerId, amount, now()]
  );
  return true;
}

export const progressionService = {
  /**
   * XP for everyone in a finished matchmaking match (called once per match,
   * after the rating update). The unique (player, match, reason) index keeps a
   * second call from paying twice.
   */
  async awardMatchXp(
    matchSlug: string,
    winner: 'team1' | 'team2' | 'none',
    abandoned: ReadonlySet<string> = new Set()
  ): Promise<void> {
    // No XP for a player who abandoned the match.
    const players = (await lobbyPlayersOfMatch(matchSlug)).filter((p) => !abandoned.has(p.player_id));
    if (players.length === 0) return;
    const stats = await db.queryAsync<{ player_id: string; score: number | null; adr: number | null }>(
      'SELECT player_id, score, adr FROM player_match_stats WHERE match_slug = ?',
      [matchSlug]
    );
    // Ranked only when the game reported how they played: rows with no
    // score and no damage for anyone (a game without stats, or stats that
    // never arrived) hold zeros, and ranking those would hand the
    // performance XP to whoever sorted first.
    const reported = stats.some((s) => Number(s.score ?? 0) > 0 || Number(s.adr ?? 0) > 0);
    const ranked = reported
      ? [...stats].sort(
          (a, b) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.adr ?? 0) - Number(a.adr ?? 0)
        )
      : [];
    const rankOf = new Map(ranked.map((s, i) => [s.player_id, i]));
    const dayStart = startOfUtcDay(now());
    for (const p of players) {
      const side = p.team === 1 ? 'team1' : 'team2';
      const result = winner === 'none' ? 'draw' : winner === side ? 'win' : 'loss';
      const hadFirstWin = result === 'win'
        ? await db.queryOneAsync<{ id: number }>(
            "SELECT id FROM xp_events WHERE player_id = ? AND reason = 'first_win' AND created_at >= ? LIMIT 1",
            [p.player_id, dayStart]
          )
        : undefined;
      const parts = xpForMatch({
        result,
        performanceRank: rankOf.has(p.player_id) ? rankOf.get(p.player_id)! : null,
        rankedPlayers: ranked.length,
        firstWinToday: result === 'win' && !hadFirstWin,
      });
      for (const part of parts) await addXp(p.player_id, matchSlug, part.amount, part.reason);
    }
    log.info(`[MATCHMAKING] XP awarded for ${matchSlug}`);
  },

  /** Level, XP and commend totals for a profile. */
  async progress(playerId: string): Promise<{
    level: number;
    totalXp: number;
    intoLevel: number;
    forNext: number;
    thumbsUp: number;
    thumbsDown: number;
    topTags: Array<{ tag: string; count: number }>;
  }> {
    const row = await db.queryOneAsync<{ total_xp: number }>('SELECT total_xp FROM player_progress WHERE player_id = ?', [playerId]);
    const totalXp = Number(row?.total_xp ?? 0);
    const counts = await db.queryOneAsync<{ up: number | string; down: number | string }>(
      `SELECT COUNT(*) FILTER (WHERE value = 1) AS up, COUNT(*) FILTER (WHERE value = -1) AS down
         FROM commends WHERE to_player_id = ?`,
      [playerId]
    );
    const tags = await db.queryAsync<{ tag: string; n: number | string }>(
      `SELECT tag, COUNT(*) AS n FROM commends WHERE to_player_id = ? AND value = 1 AND tag IS NOT NULL
        GROUP BY tag ORDER BY n DESC, tag LIMIT 3`,
      [playerId]
    );
    return {
      ...levelFor(totalXp),
      totalXp,
      thumbsUp: Number(counts?.up ?? 0),
      thumbsDown: Number(counts?.down ?? 0),
      topTags: tags.map((t) => ({ tag: t.tag, count: Number(t.n) })),
    };
  },

  /** Give (or change) a thumbs up / down to another player of the same match, within 24 h. */
  async commend(fromId: string, matchSlug: string, toId: string, body: unknown): Promise<{ value: 1 | -1; tag: string | null }> {
    const parsed = parseCommend(body);
    if (!parsed.ok) throw new ProgressionError(400, parsed.error);
    if (fromId === toId) throw new ProgressionError(400, 'You cannot rate yourself');
    const players = await lobbyPlayersOfMatch(matchSlug);
    if (!players.some((p) => p.player_id === fromId) || !players.some((p) => p.player_id === toId)) {
      throw new ProgressionError(404, 'No such match for you');
    }
    const match = await db.queryOneAsync<{ status: string; completed_at: number | null }>(
      'SELECT status, completed_at FROM matches WHERE slug = ?',
      [matchSlug]
    );
    if (match?.status !== 'completed') throw new ProgressionError(409, 'The match has not ended yet');
    if (match.completed_at && now() - Number(match.completed_at) > COMMEND_WINDOW_SECONDS) {
      throw new ProgressionError(409, 'Commends close 24 hours after the match');
    }
    await db.runAsync(
      `INSERT INTO commends (match_slug, from_player_id, to_player_id, value, tag, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (match_slug, from_player_id, to_player_id) DO UPDATE SET value = EXCLUDED.value, tag = EXCLUDED.tag, created_at = EXCLUDED.created_at`,
      [matchSlug, fromId, toId, parsed.value, parsed.tag, now()]
    );
    return { value: parsed.value, tag: parsed.tag };
  },

  /** The post-match screen for a player of the match. */
  async result(playerId: string, matchSlug: string) {
    const players = await lobbyPlayersOfMatch(matchSlug);
    if (!players.some((p) => p.player_id === playerId)) throw new ProgressionError(404, 'No such match for you');
    const match = await db.queryOneAsync<{ status: string }>(
      'SELECT status FROM matches WHERE slug = ?',
      [matchSlug]
    );
    const ids = players.map((p) => p.player_id);
    const marks = ids.map(() => '?').join(', ');
    const names = new Map(
      (await db.queryAsync<{ id: string; name: string | null }>(`SELECT id, name FROM players WHERE id IN (${marks})`, ids)).map((r) => [
        r.id,
        r.name || r.id,
      ])
    );
    const stats = new Map(
      (
        await db.queryAsync<{
          player_id: string;
          kills: number | null;
          deaths: number | null;
          assists: number | null;
          adr: number | null;
          headshots: number | null;
          mvps: number | null;
          score: number | null;
          won_match: boolean;
        }>('SELECT * FROM player_match_stats WHERE match_slug = ?', [matchSlug])
      ).map((s) => [s.player_id, s])
    );
    const maps = await db.queryAsync<{ map_name: string | null; team1_score: number; team2_score: number; winner_team: string | null }>(
      'SELECT map_name, team1_score, team2_score, winner_team FROM match_map_results WHERE match_slug = ? ORDER BY map_number',
      [matchSlug]
    );
    const rating = await db.queryOneAsync<{ mu_before: number; sigma_before: number; mu_after: number; sigma_after: number }>(
      'SELECT mu_before, sigma_before, mu_after, sigma_after FROM mm_rating_history WHERE player_id = ? AND match_slug = ?',
      [playerId, matchSlug]
    );
    const xp = await db.queryAsync<{ reason: string; amount: number }>(
      'SELECT reason, amount FROM xp_events WHERE player_id = ? AND match_slug = ? ORDER BY id',
      [playerId, matchSlug]
    );
    const given = await db.queryAsync<{ to_player_id: string; value: number; tag: string | null }>(
      'SELECT to_player_id, value, tag FROM commends WHERE match_slug = ? AND from_player_id = ?',
      [matchSlug, playerId]
    );
    return {
      matchSlug,
      status: match?.status ?? null,
      maps: maps.map((m) => ({
        map: m.map_name,
        team1: Number(m.team1_score),
        team2: Number(m.team2_score),
        winner: m.winner_team,
      })),
      scoreboard: [1, 2].map((team) => ({
        team,
        players: players
          .filter((p) => p.team === team)
          .map((p) => {
            const s = stats.get(p.player_id);
            return {
              id: p.player_id,
              name: names.get(p.player_id) ?? p.player_id,
              kills: s?.kills ?? null,
              deaths: s?.deaths ?? null,
              assists: s?.assists ?? null,
              adr: s?.adr ?? null,
              hsPercent: s?.kills ? Math.round(((s.headshots ?? 0) / s.kills) * 100) : null,
              mvps: s?.mvps ?? null,
              score: s?.score ?? null,
            };
          })
          .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)),
      })),
      rating: rating
        ? {
            before: Number(rating.mu_before),
            after: Number(rating.mu_after),
            sigmaBefore: Number(rating.sigma_before),
            sigmaAfter: Number(rating.sigma_after),
          }
        : null,
      xp: xp.map((x) => ({ reason: x.reason, amount: Number(x.amount) })),
      progress: await progressionService.progress(playerId),
      commendsGiven: given.map((g) => ({ playerId: g.to_player_id, value: Number(g.value), tag: g.tag })),
    };
  },

  /**
   * The leaderboard for a mode: players with at least `minGames` rated
   * matchmaking matches in the last 30 days, best conservative rating
   * (mu − 3 sigma, shown as display Elo) first.
   */
  async leaderboard(mode: string, minGames = 10): Promise<
    Array<{ rank: number; id: string; name: string; elo: number; games: number; wins: number; level: number }>
  > {
    const since = now() - 30 * 86400;
    const rows = await db.queryAsync<{
      player_id: string;
      name: string | null;
      mu: number;
      sigma: number;
      games: number;
      wins: number;
      total_xp: number | null;
    }>(
      `SELECT r.player_id, p.name, r.mu, r.sigma, r.games, r.wins, pp.total_xp
         FROM mm_ratings r
         JOIN players p ON p.id = r.player_id
         LEFT JOIN player_progress pp ON pp.player_id = r.player_id
        WHERE r.game = 'cs2' AND r.mode = ?
          AND (SELECT COUNT(*) FROM mm_rating_history h
                WHERE h.player_id = r.player_id AND h.mode = r.mode AND h.created_at > ?) >= ?
        ORDER BY (r.mu - 3 * r.sigma) DESC, r.games DESC
        LIMIT 100`,
      [mode, since, minGames]
    );
    return rows.map((r, i) => ({
      rank: i + 1,
      id: r.player_id,
      name: r.name || r.player_id,
      elo: openSkillToDisplayElo(osRating({ mu: Number(r.mu), sigma: Number(r.sigma) })),
      games: Number(r.games),
      wins: Number(r.wins),
      level: levelFor(Number(r.total_xp ?? 0)).level,
    }));
  },

  /** A player's matchmaking matches, newest first, with the rating before and after each. */
  async history(playerId: string, limit = 20): Promise<
    Array<{
      matchSlug: string;
      at: number;
      map: string | null;
      own: number | null;
      other: number | null;
      result: 'win' | 'loss' | 'draw' | null;
      eloBefore: number;
      eloAfter: number;
    }>
  > {
    const rows = await db.queryAsync<{
      match_slug: string;
      created_at: number;
      mu_before: number;
      sigma_before: number;
      mu_after: number;
      sigma_after: number;
      team: number | null;
      map: string | null;
    }>(
      `SELECT h.match_slug, h.created_at, h.mu_before, h.sigma_before, h.mu_after, h.sigma_after, lp.team, l.map
         FROM mm_rating_history h
         LEFT JOIN mm_lobbies l ON l.match_slug = h.match_slug
         LEFT JOIN mm_lobby_players lp ON lp.lobby_id = l.id AND lp.player_id = h.player_id
        WHERE h.player_id = ?
        ORDER BY h.created_at DESC, h.id DESC
        LIMIT ?`,
      [playerId, Math.min(100, Math.max(1, limit))]
    );
    const out = [];
    for (const r of rows) {
      const m = await db.queryOneAsync<{ team1_score: number; team2_score: number; winner_team: string | null }>(
        'SELECT team1_score, team2_score, winner_team FROM match_map_results WHERE match_slug = ? ORDER BY map_number LIMIT 1',
        [r.match_slug]
      );
      const side = r.team === 1 ? 'team1' : r.team === 2 ? 'team2' : null;
      const own = m && side ? Number(side === 'team1' ? m.team1_score : m.team2_score) : null;
      const other = m && side ? Number(side === 'team1' ? m.team2_score : m.team1_score) : null;
      const result: 'win' | 'loss' | 'draw' | null =
        own === null || other === null ? null : own > other ? 'win' : own < other ? 'loss' : 'draw';
      out.push({
        matchSlug: r.match_slug,
        at: Number(r.created_at),
        map: r.map,
        own,
        other,
        result,
        eloBefore: openSkillToDisplayElo(osRating({ mu: Number(r.mu_before), sigma: Number(r.sigma_before) })),
        eloAfter: openSkillToDisplayElo(osRating({ mu: Number(r.mu_after), sigma: Number(r.sigma_after) })),
      });
    }
    return out;
  },

  /**
   * Admin review list: players who got a thumbs down from at least `min`
   * different voters in the last 30 days. Voters who were in the same party
   * in that match count as one, so a group can't pile on.
   */
  async reviewList(min = 5): Promise<
    Array<{ id: string; name: string; voters: number; reasons: Array<{ tag: string; count: number }> }>
  > {
    const since = now() - 30 * 86400;
    const rows = await db.queryAsync<{ to_player_id: string; voters: number | string }>(
      `SELECT c.to_player_id, COUNT(DISTINCT c.match_slug || ':' || COALESCE(lp.party_id, c.from_player_id)) AS voters
         FROM commends c
         LEFT JOIN mm_lobbies l ON l.match_slug = c.match_slug
         LEFT JOIN mm_lobby_players lp ON lp.lobby_id = l.id AND lp.player_id = c.from_player_id
        WHERE c.value = -1 AND c.created_at > ?
        GROUP BY c.to_player_id
       HAVING COUNT(DISTINCT c.match_slug || ':' || COALESCE(lp.party_id, c.from_player_id)) >= ?
        ORDER BY voters DESC
        LIMIT 100`,
      [since, min]
    );
    const out = [];
    for (const r of rows) {
      const name = await db.queryOneAsync<{ name: string | null }>('SELECT name FROM players WHERE id = ?', [r.to_player_id]);
      const reasons = await db.queryAsync<{ tag: string; n: number | string }>(
        `SELECT tag, COUNT(*) AS n FROM commends WHERE to_player_id = ? AND value = -1 AND created_at > ?
          GROUP BY tag ORDER BY n DESC, tag`,
        [r.to_player_id, since]
      );
      out.push({
        id: r.to_player_id,
        name: name?.name || r.to_player_id,
        voters: Number(r.voters),
        reasons: reasons.map((x) => ({ tag: x.tag, count: Number(x.n) })),
      });
    }
    return out;
  },

  /** Admin: add or remove XP by hand (`reason = admin`, with a note). */
  async adjustXp(playerId: string, amount: number, note: string): Promise<void> {
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      throw new ProgressionError(400, 'amount must be a whole number other than 0');
    }
    await addXp(playerId, null, amount, 'admin', note.slice(0, 200));
    // XP never goes below 0 in total.
    await db.runAsync('UPDATE player_progress SET total_xp = GREATEST(total_xp, 0) WHERE player_id = ?', [playerId]);
  },
};
