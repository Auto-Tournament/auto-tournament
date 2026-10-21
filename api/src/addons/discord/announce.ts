/**
 * Match cards (the Discord add-on, Modules → Discord). Each match of a running
 * tournament has one card in each team's own channel (teamChannels.ts),
 * posted once with a ping to the team and then edited as it moves on:
 * scheduled (its start time), the map veto (bans, picks, who is up), ready on
 * its server, live (the score), and Done (each map's score, the top player,
 * what the winner plays next). A cancelled match's card goes. Nothing public.
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
import { announceMessage, feedStage, teamLabel, timeoutText, type CardInput } from './announceText';
import { matchTimeFields } from '../../services/matchTimes';
import { discordIdOf } from '../../services/notifyChannels';
import { matchLiveStatsService } from '../../services/matchLiveStatsService';
import { mapLabel, roundLabel } from '../../services/shareCards/core';

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
  tournament_status: string | null;
  tournament_settings: string | null;
  veto_state: string | null;
  starts_at: number | null;
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

/** The veto so far from the match's veto state, and who is up. */
function vetoOf(raw: string | null):
  | (NonNullable<CardInput['veto']> & {
      status: string | null;
      /** Steps the platform took because the team ran out of time. */
      timedOut: Array<{ step: number; team: 1 | 2; text: string }>;
    })
  | null {
  try {
    const v = JSON.parse(raw ?? 'null') as {
      status?: string;
      actions?: Array<{
        step?: number;
        team?: string;
        action?: string;
        mapName?: string;
        side?: string;
        timedOut?: boolean;
      }>;
      currentTurn?: string;
      currentAction?: string;
    } | null;
    if (!v) return null;
    const maps = (action: string) =>
      (v.actions ?? [])
        .filter((a) => a.action === action && a.mapName)
        .map((a) => mapLabel(a.mapName ?? null) ?? '');
    const team = ({ team1: 1, team2: 2 } as const)[v.currentTurn ?? ''] ?? null;
    const action = v.currentAction === 'side_pick' ? 'pick a side' : v.currentAction;
    return {
      status: v.status ?? null,
      banned: maps('ban'),
      picked: maps('pick'),
      next: team && action ? { team, action } : null,
      timedOut: (v.actions ?? []).flatMap((a) => {
        const side = ({ team1: 1, team2: 2 } as const)[a.team ?? ''];
        if (!a.timedOut || !side || a.step === undefined) return [];
        const text = timeoutText(a.action ?? '', mapLabel(a.mapName ?? null), a.side ?? null);
        return [{ step: a.step, team: side, text }];
      }),
    };
  } catch {
    return null;
  }
}

/** The start of a scheduled match (Manage › Schedule), or null. */
function startsAtOf(m: MatchState): number | null {
  try {
    return matchTimeFields(
      { round: m.round, starts_at: m.starts_at },
      JSON.parse(m.tournament_settings ?? '{}')
    ).startsAt;
  } catch {
    return null;
  }
}

/** What each team's match card last said (by match and team), so a change edits it once. */
const teamCards = new Map<string, string>();

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
  const token = await botToken();
  if (!token) return;
  const state = await db.queryOneAsync<MatchState>(
    `SELECT m.status, m.completed_at, m.winner_id, m.team1_id, m.team2_id, m.round, m.next_match_id,
            m.config, m.tournament_id, tr.name AS tournament, tr.type AS tournament_type, m.bracket,
            tr.status AS tournament_status, tr.settings AS tournament_settings, m.veto_state, m.starts_at
       FROM matches m LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.slug = ?`,
    [slug]
  );
  if (!state) return;
  // A match that ended long ago (its clips or stats changed since) is not news.
  const fresh = (state.completed_at ?? 0) > Date.now() / 1000 - 30 * 60;
  const resultDue = state.status === 'completed' && state.winner_id !== null && fresh;
  // Only a running tournament's matches have a card in their teams' channels.
  const stage =
    state.tournament_status === 'in_progress'
      ? feedStage(
          state.status,
          vetoOf(state.veto_state)?.status ?? null,
          !!state.team1_id && !!state.team2_id
        )
      : null;
  const sent = await db.queryAsync<{ event: string; message_id: string | null }>(
    'SELECT event, message_id FROM discord_announcements WHERE match_slug = ?',
    [slug]
  );
  // Each team's card: the stage it is at, then the result; a cancelled match's card goes.
  const cardStage = stage ?? (resultDue ? 'result' : null);
  const cancelled = state.status === 'cancelled' && sent.some((s) => s.event.startsWith('card:'));
  // A veto step the team ran out of time for: said once in that team's channel, no ping.
  const timedOut = (vetoOf(state.veto_state)?.timedOut ?? []).filter(
    (t) => !sent.some((s) => s.event === `timeout:${t.step}`)
  );
  for (const t of timedOut) {
    const own = await teamChannelOf(
      state.tournament_id,
      t.team === 1 ? state.team1_id : state.team2_id
    );
    if (!own) continue;
    const claimed = await db.queryOneAsync<{ event: string }>(
      `INSERT INTO discord_announcements (match_slug, event, sent_at) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING event`,
      [slug, `timeout:${t.step}`, Math.floor(Date.now() / 1000)]
    );
    if (claimed) {
      await discordFetch(token, `/channels/${own}/messages`, {
        method: 'POST',
        body: { content: t.text, allowed_mentions: { parse: [] } },
      });
    }
  }
  if (!cardStage && !cancelled) return;
  const match = await matchRow(slug);
  const team1 = match?.t1;
  const team2 = match?.t2;
  if (!team1 || !team2) return;
  const post = async (
    channelId: string,
    body: ReturnType<typeof announceMessage>,
    what: string
  ): Promise<string | null> => {
    const posted = await discordFetch(token, `/channels/${channelId}/messages`, {
      method: 'POST',
      body,
    });
    if (posted.ok && typeof posted.body.id === 'string') return posted.body.id;
    log.warn(`[Discord] ${what} for ${slug} failed: ${posted.status}`);
    await adminNoticeService.raise(
      'discord_failed',
      { matchSlug: slug, what, detail: `Discord answered ${posted.status}` },
      `discord_failed:announce:${channelId}`
    );
    return null;
  };
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
      startsAt: startsAtOf(state),
      veto: vetoOf(state.veto_state),
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
  // One card per match in each team's own channel (teamChannels.ts): posted once with a
  // ping, then edited as the match moves on (an edit pings no one). A team whose channel
  // is not made yet gets it once it is (teamChannels.ts nudges this).
  const roles = await rolesOf(state);
  for (const [teamId, roleId] of [
    [state.team1_id, roles.team1],
    [state.team2_id, roles.team2],
  ] as const) {
    const own = await teamChannelOf(state.tournament_id, teamId);
    if (!teamId || !own) continue;
    const event = `card:${teamId}`;
    const row = sent.find((s) => s.event === event);
    const key = `${slug}:${teamId}`;
    if (cancelled) {
      if (row?.message_id) {
        await discordFetch(token, `/channels/${own}/messages/${row.message_id}`, {
          method: 'DELETE',
        });
      }
      teamCards.delete(key);
      continue;
    }
    if (!cardStage) continue;
    // With the team's role: the line above the card follows the stage too ("…is done").
    const body = announceMessage(await card(cardStage), roleId);
    const text = JSON.stringify([body.content ?? null, body.embeds, body.components ?? []]);
    if (!row) {
      // Claimed first, like the result, so a burst of changes posts it once.
      const claimed = await db.queryOneAsync<{ event: string }>(
        `INSERT INTO discord_announcements (match_slug, event, sent_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING RETURNING event`,
        [slug, event, Math.floor(Date.now() / 1000)]
      );
      if (!claimed) continue;
      const posted = await post(own, body, 'Match card');
      if (posted) {
        teamCards.set(key, text);
        await db.runAsync(
          'UPDATE discord_announcements SET message_id = ? WHERE match_slug = ? AND event = ?',
          [posted, slug, event]
        );
      }
    } else if (row.message_id && teamCards.get(key) !== text) {
      teamCards.set(key, text);
      await discordFetch(token, `/channels/${own}/messages/${row.message_id}`, {
        method: 'PATCH',
        body: {
          ...(body.content ? { content: body.content } : {}),
          embeds: body.embeds,
          components: body.components ?? [],
          allowed_mentions: { parse: [] },
        },
      });
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
