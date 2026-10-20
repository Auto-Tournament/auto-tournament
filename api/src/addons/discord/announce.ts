/**
 * Match announcements (the Discord add-on, Modules → Discord): a post in the
 * channel the admin picked when a match is ready on its server, when it goes
 * live, and its result. Each once per match (discord_announcements); a match
 * that is reloaded (failover) is not announced again.
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
import { announceText, dueEvents } from './announceText';

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
}

/** Maps won by each side (or the map's rounds for a Bo1). */
async function resultOf(slug: string, m: MatchState): Promise<[number, number]> {
  const maps = await db.queryAsync<{ t1: number; t2: number; winner_team: string | null }>(
    'SELECT team1_score AS t1, team2_score AS t2, winner_team FROM match_map_results WHERE match_slug = ? ORDER BY map_number',
    [slug]
  );
  if (maps.length === 1) return [maps[0].t1, maps[0].t2];
  const won = (side: 'team1' | 'team2', id: string | null) =>
    maps.filter((r) => r.winner_team === side || (id !== null && r.winner_team === id)).length;
  return [won('team1', m.team1_id), won('team2', m.team2_id)];
}

const chains = new Map<string, Promise<void>>();

async function announceNow(slug: string): Promise<void> {
  const channelId = await announceChannel();
  if (!channelId) return;
  const token = await botToken();
  if (!token) return;
  const state = await db.queryOneAsync<MatchState>(
    'SELECT status, completed_at, winner_id, team1_id, team2_id FROM matches WHERE slug = ?',
    [slug]
  );
  if (!state) return;
  // A match that ended long ago (its clips or stats changed since) is not news.
  const fresh = (state.completed_at ?? 0) > Date.now() / 1000 - 30 * 60;
  const due = dueEvents(state.status, state.winner_id !== null && fresh);
  if (!due.length) return;
  const sent = await db.queryAsync<{ event: string }>(
    'SELECT event FROM discord_announcements WHERE match_slug = ?',
    [slug]
  );
  const todo = due.filter((e) => !sent.some((s) => s.event === e));
  if (!todo.length) return;
  const match = await matchRow(slug);
  if (!match?.t1 || !match.t2) return;
  const site = siteUrl();
  const url = site ? `${site}/match/${encodeURIComponent(slug)}` : null;
  for (const event of todo) {
    // Claimed first, so a burst of changes posts it once.
    const claimed = await db.queryOneAsync<{ event: string }>(
      `INSERT INTO discord_announcements (match_slug, event, sent_at) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING event`,
      [slug, event, Math.floor(Date.now() / 1000)]
    );
    if (!claimed) continue;
    const score = event === 'result' ? await resultOf(slug, state) : null;
    const result =
      score && state.winner_id
        ? { winner: state.winner_id === state.team1_id ? (1 as const) : (2 as const), score }
        : null;
    const posted = await discordFetch(token, `/channels/${channelId}/messages`, {
      method: 'POST',
      body: {
        content: announceText(event, match.t1, match.t2, result, url),
        allowed_mentions: { parse: [] },
      },
    });
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
