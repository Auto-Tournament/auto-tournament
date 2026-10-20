/**
 * Match announcements (the Discord add-on, Modules → Discord): a post in the
 * channel the admin picked when a match is ready on its server (format, maps),
 * when it goes live, and its result (each map's score, the top player, what
 * the winner plays next). Each once per match (discord_announcements); a match
 * that is reloaded (failover) is not announced again. The live card is edited
 * as the score moves, so the channel follows the match without a post a round.
 *
 * Listens on the match change bus like the team voice channels.
 */
import { db } from '../../config/database';
import { onMatchChanged } from '../../core/matchChangeBus';
import { log } from '../../utils/logger';
import { adminNoticeService } from '../../services/adminNoticeService';
import { matchRow } from '../../services/matchNotices';
import { botToken } from './bot';
import { discordFetch } from './rest';
import { announceMessage, dueEvents, teamLabel, type CardInput } from './announceText';
import { discordIdOf } from '../../services/notifyChannels';
import { matchLiveStatsService } from '../../services/matchLiveStatsService';
import { mapLabel, roundLabel } from '../../services/shareCards/core';

const CHANNEL_KEY = 'discord_announce_channel';

export async function announceChannel(): Promise<string | null> {
  return (await db.getAppSettingAsync(CHANNEL_KEY).catch(() => null)) ?? null;
}

export async function setAnnounceChannel(channelId: string | null): Promise<string | null> {
  await db.setAppSettingAsync(CHANNEL_KEY, channelId);
  return channelId;
}

const siteUrl = () => (process.env.FRONTEND_BASE_URL ?? '').trim().replace(/\/+$/, '') || null;

interface MatchState {
  status: string;
  completed_at: number | null;
  winner_id: string | null;
  team1_id: string | null;
  team2_id: string | null;
  round: number | null;
  next_match_id: number | null;
  config: string | null;
  tournament_id: number | null;
  tournament_type: string | null;
  bracket: string | null;
  tournament: string | null;
}

/** Each map's score, and maps won by each side (or the map's rounds for a Bo1). */
async function resultOf(
  slug: string,
  m: MatchState
): Promise<{
  score: [number, number];
  maps: Array<{ map: string | null; score: [number, number] }>;
}> {
  const rows = await db.queryAsync<{
    t1: number;
    t2: number;
    winner_team: string | null;
    map_name: string | null;
  }>(
    'SELECT team1_score AS t1, team2_score AS t2, winner_team, map_name FROM match_map_results WHERE match_slug = ? ORDER BY map_number',
    [slug]
  );
  const maps = rows.map((r) => ({
    map: mapLabel(r.map_name),
    score: [Number(r.t1), Number(r.t2)] as [number, number],
  }));
  if (rows.length === 1) return { score: maps[0].score, maps };
  const won = (side: 'team1' | 'team2', id: string | null) =>
    rows.filter((r) => r.winner_team === side || (id !== null && r.winner_team === id)).length;
  return { score: [won('team1', m.team1_id), won('team2', m.team2_id)], maps };
}

/** The match's best player by kills (ADR breaks a tie), from its stats. */
async function topPlayer(slug: string) {
  const row = await db.queryOneAsync<{
    player_id: string;
    name: string | null;
    kills: number;
    deaths: number;
    adr: number | null;
  }>(
    `SELECT s.player_id, COALESCE(p.name, s.player_id) AS name, SUM(s.kills)::int AS kills, SUM(s.deaths)::int AS deaths,
            AVG(s.adr) AS adr
       FROM player_match_stats s LEFT JOIN players p ON p.id = s.player_id
      WHERE s.match_slug = ?
      GROUP BY s.player_id, p.name
      ORDER BY kills DESC, adr DESC NULLS LAST LIMIT 1`,
    [slug]
  );
  return row?.name
    ? {
        name: row.name,
        kills: row.kills,
        deaths: row.deaths,
        adr: row.adr === null ? null : Number(row.adr),
        discordId: await discordIdOf(row.player_id),
      }
    : null;
}

/** What the winner plays next: "@Kestrel plays @Halcyon next (Final)", "... opponent to be decided", or none. */
async function nextFor(m: MatchState, winnerName: string): Promise<string | null> {
  if (!m.next_match_id) {
    // The last match of a finished tournament: its winner won the tournament.
    if (!m.tournament_id || !m.tournament) return null;
    const open = await db.queryOneAsync<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM matches WHERE tournament_id = ? AND status <> 'completed'",
      [m.tournament_id]
    );
    return open?.n === 0 ? `${winnerName} win ${m.tournament}.` : null;
  }
  const next = await db.queryOneAsync<{
    slug: string;
    round: number;
    bracket: string | null;
    team1_id: string | null;
    team2_id: string | null;
    t1: string | null;
    t2: string | null;
  }>(
    `SELECT n.slug, n.round, n.bracket, n.team1_id, n.team2_id, t1.name AS t1, t2.name AS t2
       FROM matches n LEFT JOIN teams t1 ON t1.id = n.team1_id LEFT JOIN teams t2 ON t2.id = n.team2_id
      WHERE n.id = ?`,
    [m.next_match_id]
  );
  if (!next) return null;
  const stage =
    (await stageOf(next.slug, { ...m, round: Number(next.round), bracket: next.bracket })) ??
    roundLabel(next.slug, Number(next.round));
  const opponentFirst = next.team1_id !== m.winner_id;
  const opponentName = opponentFirst ? next.t1 : next.t2;
  const opponent = opponentName
    ? teamLabel(opponentName, await roleOf(opponentFirst ? next.team1_id : next.team2_id))
    : null;
  return opponent
    ? `${winnerName} plays ${opponent} next (${stage}).`
    : `${winnerName} goes on to ${stage}; the opponent is not decided yet.`;
}

/**
 * The match's stage: "Final", "Semi-final" and "Quarter-final" in a single
 * elimination bracket, "Grand final" and "Upper/Lower final" in a double one,
 * else "Round 2" (roundLabel).
 */
async function stageOf(slug: string, m: MatchState): Promise<string | null> {
  if (m.round === null) return null;
  const round = Number(m.round);
  const plain =
    m.bracket === 'GF' || m.bracket === 'GF_RESET' ? 'Grand final' : roundLabel(slug, round);
  if (!m.tournament_id || !/elimination/.test(m.tournament_type ?? '') || plain === 'Grand final') {
    return plain;
  }
  const last = await db.queryOneAsync<{ r: number | null }>(
    'SELECT MAX(round)::int AS r FROM matches WHERE tournament_id = ? AND bracket IS NOT DISTINCT FROM ?',
    [m.tournament_id, m.bracket]
  );
  const lastRound = last?.r ?? null;
  if (lastRound === null) return plain;
  if (m.tournament_type === 'double_elimination') {
    return round === lastRound ? `${m.bracket === 'LB' ? 'Lower' : 'Upper'} final` : plain;
  }
  if (round === lastRound) return 'Final';
  if (round === lastRound - 1) return 'Semi-final';
  if (round === lastRound - 2) return 'Quarter-final';
  return plain;
}

/** Format and maps from the match's config: "Bo3", ["Mirage", "Inferno", "Nuke"]. */
function formatOf(config: string | null): { format: string | null; maps: string[] } {
  try {
    const c = JSON.parse(config ?? '{}') as { num_maps?: number; maplist?: string[] | null };
    const maps = (c.maplist ?? []).map((m) => mapLabel(m)).filter((m): m is string => !!m);
    return { format: c.num_maps ? `Bo${c.num_maps}` : null, maps };
  } catch {
    return { format: null, maps: [] };
  }
}

/** The live card's message, and what it last said, so a change edits it once. */
const liveCards = new Map<string, string>();

/** The teams' roles (team channels and roles), newest tournament first. */
/** A team's own text channel in this tournament (teamChannels.ts), or null. */
async function teamChannelOf(
  tournamentId: number | null,
  teamId: string | null
): Promise<string | null> {
  if (!tournamentId || !teamId) return null;
  const row = await db.queryOneAsync<{ channel_id: string }>(
    'SELECT channel_id FROM discord_team_channels WHERE tournament_id = ? AND team_id = ?',
    [tournamentId, teamId]
  );
  return row?.channel_id ?? null;
}

/** A team's Discord role (team channels and roles), newest tournament first. */
async function roleOf(teamId: string | null): Promise<string | null> {
  if (!teamId) return null;
  const row = await db.queryOneAsync<{ role_id: string | null }>(
    `SELECT role_id FROM discord_team_channels WHERE team_id = ? AND role_id IS NOT NULL
      ORDER BY tournament_id DESC LIMIT 1`,
    [teamId]
  );
  return row?.role_id ?? null;
}

async function rolesOf(m: MatchState): Promise<{ team1: string | null; team2: string | null }> {
  return { team1: await roleOf(m.team1_id), team2: await roleOf(m.team2_id) };
}

const chains = new Map<string, Promise<void>>();

async function announceNow(slug: string): Promise<void> {
  const channelId = await announceChannel();
  if (!channelId) return;
  const token = await botToken();
  if (!token) return;
  const state = await db.queryOneAsync<MatchState>(
    `SELECT m.status, m.completed_at, m.winner_id, m.team1_id, m.team2_id, m.round, m.next_match_id,
            m.config, m.tournament_id, tr.name AS tournament, tr.type AS tournament_type, m.bracket
       FROM matches m LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.slug = ?`,
    [slug]
  );
  if (!state) return;
  // A match that ended long ago (its clips or stats changed since) is not news.
  const fresh = (state.completed_at ?? 0) > Date.now() / 1000 - 30 * 60;
  const due = dueEvents(state.status, state.winner_id !== null && fresh);
  if (!due.length) return;
  const sent = await db.queryAsync<{ event: string; message_id: string | null }>(
    'SELECT event, message_id FROM discord_announcements WHERE match_slug = ?',
    [slug]
  );
  const todo = due.filter((e) => !sent.some((s) => s.event === e));
  const liveSent = sent.find((s) => s.event === 'live' && s.message_id);
  // Once completed, the live card is left with the last map's score ("Over on Nuke: ...").
  const overDue =
    state.status === 'completed' && !!liveSent && !sent.some((s) => s.event === 'over');
  if (!todo.length && !(state.status === 'live' && liveSent) && !overDue) return;
  const match = await matchRow(slug);
  const team1 = match?.t1;
  const team2 = match?.t2;
  if (!team1 || !team2) return;
  const site = siteUrl();
  const url = site ? `${site}/match/${encodeURIComponent(slug)}` : null;
  const card = async (event: CardInput['event']): Promise<CardInput> => {
    const base: CardInput = {
      event,
      team1,
      team2,
      url,
      roles: await rolesOf(state),
      tournament: state.tournament,
      stage: await stageOf(slug, state),
      ...formatOf(state.config),
    };
    if (event === 'live') {
      const s = matchLiveStatsService.getStats(slug);
      if (s && s.status !== 'warmup') {
        base.live = {
          map: mapLabel(s.mapName ?? null),
          mapNumber: s.mapNumber,
          totalMaps: s.totalMaps,
          score: [s.team1Score, s.team2Score],
          // The round being played: the live stats' counter can stay 0 (simulated matches).
          round: s.roundNumber || s.team1Score + s.team2Score + 1,
          series: [s.team1SeriesScore, s.team2SeriesScore],
        };
      }
    }
    if (event === 'result' && state.winner_id) {
      const r = await resultOf(slug, state);
      const winner = state.winner_id === state.team1_id ? (1 as const) : (2 as const);
      base.result = {
        winner,
        ...r,
        top: await topPlayer(slug),
        next: await nextFor(
          state,
          winner === 1 ? teamLabel(team1, base.roles.team1) : teamLabel(team2, base.roles.team2)
        ),
      };
    }
    return base;
  };
  // The live card follows the score: edited when what it says changes.
  const editLive = (body: ReturnType<typeof announceMessage>, messageId: string) =>
    discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      // The embed and button only: an edit pings no one.
      body: {
        embeds: body.embeds,
        components: body.components ?? [],
        allowed_mentions: { parse: [] },
      },
    });
  const liveId = liveSent ? liveSent.message_id : null;
  if (overDue && liveId) {
    // Claimed first, like the posts, so it is edited once.
    const claimed = await db.queryOneAsync<{ event: string }>(
      `INSERT INTO discord_announcements (match_slug, event, sent_at) VALUES (?, 'over', ?)
       ON CONFLICT DO NOTHING RETURNING event`,
      [slug, Math.floor(Date.now() / 1000)]
    );
    const won = await resultOf(slug, state);
    const maps = won.maps;
    if (claimed && maps.length > 0) {
      const lastMap = maps[maps.length - 1];
      const live: NonNullable<CardInput['live']> = {
        map: lastMap.map,
        mapNumber: maps.length - 1,
        totalMaps: maps.length,
        score: lastMap.score,
        round: lastMap.score[0] + lastMap.score[1],
        series: won.score,
      };
      await editLive(announceMessage({ ...(await card('live')), live, over: true }), liveId);
    }
  }
  if (state.status === 'live' && liveSent?.message_id) {
    const body = announceMessage(await card('live'));
    const text = JSON.stringify(body.embeds);
    if (liveCards.get(slug) !== text) {
      liveCards.set(slug, text);
      await editLive(body, liveSent.message_id);
    }
  }
  if (state.status !== 'live') liveCards.delete(slug);
  for (const event of todo) {
    // Claimed first, so a burst of changes posts it once.
    const claimed = await db.queryOneAsync<{ event: string }>(
      `INSERT INTO discord_announcements (match_slug, event, sent_at) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING event`,
      [slug, event, Math.floor(Date.now() / 1000)]
    );
    if (!claimed) continue;
    const posted = await discordFetch(token, `/channels/${channelId}/messages`, {
      method: 'POST',
      body: announceMessage(await card(event)),
    });
    if (posted.ok && typeof posted.body.id === 'string') {
      await db.runAsync(
        'UPDATE discord_announcements SET message_id = ? WHERE match_slug = ? AND event = ?',
        [posted.body.id, slug, event]
      );
    }
    // Ready: each team is pinged in its own channel (#results pings no one).
    if (event === 'ready') {
      const ready = await card('ready');
      for (const [teamId, roleId] of [
        [state.team1_id, ready.roles.team1],
        [state.team2_id, ready.roles.team2],
      ] as const) {
        const own = await teamChannelOf(state.tournament_id, teamId);
        if (own && roleId) {
          await discordFetch(token, `/channels/${own}/messages`, {
            method: 'POST',
            body: announceMessage(ready, roleId),
          });
        }
      }
    }
    if (!posted.ok) {
      log.warn(`[Discord] Announcing ${slug} (${event}) failed: ${posted.status}`);
      await adminNoticeService.raise(
        'discord_failed',
        {
          matchSlug: slug,
          what: 'Match announcement',
          detail: `Discord answered ${posted.status}`,
        },
        `discord_failed:announce:${channelId}`
      );
    }
  }
}

export function announceMatch(slug: string): Promise<void> {
  const next = (chains.get(slug) ?? Promise.resolve())
    .then(() => announceNow(slug))
    .catch((error) => {
      log.warn('[Discord] Match announcement failed', {
        matchSlug: slug,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      if (chains.get(slug) === next) chains.delete(slug);
    });
  chains.set(slug, next);
  return next;
}

let unsubscribe: (() => void) | null = null;

export function startAnnouncements(): void {
  if (unsubscribe) return;
  unsubscribe = onMatchChanged((ref) => {
    if (ref.slug && !ref.deleted) void announceMatch(ref.slug);
  });
}

export function stopAnnouncements(): void {
  unsubscribe?.();
  unsubscribe = null;
}
