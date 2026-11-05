/**
 * "Getting on the server" (settings.fullTeamMinutes, default 10; Claude Design,
 * the match room): once a tournament match is loaded, each team has that long
 * to have a full team on the server, subs included. Then:
 * - one team short: the match holds while the complete team's captain
 *   chooses, in game (the HUD's buttons or `.walkover` / `.play`: Ready Up
 *   sends `event.walkover_choice`, driver.ts) or on the match
 *   page (POST /api/match-check-in/:slug/walkover): take the walkover, or
 *   play them short. No choice in two minutes: the walkover stands.
 * - both short: the match holds until an admin decides (Needs you). Once
 *   they let it go, it plays: no second timer for that load.
 * Warnings go to the server chat two minutes and 30 seconds before.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { runFleetCommand, type IssuedBy } from './driver';
import { holdMatch, notHeldSql } from '../../../services/matchHolds';
import { playerConnectionService } from '../../../services/playerConnectionService';
import type { Untrusted } from '../../../utils/untrusted';
import {
  botsPlay,
  decideWalkover,
  fullTeamMinutesOf,
  rosterOf,
  shortSides,
} from '../../../services/walkoverOffers';

const TICK_MS = 5_000;
const CHOICE_S = 120;
const ISSUED_BY: IssuedBy = { userId: 'platform:full-team', name: 'Full team', root: false };
const ACTOR = { userId: 'platform:full-team', name: 'Full team' };

const sent = new Map<string, { warned120: boolean; warned30: boolean; done: boolean }>();
let timer: ReturnType<typeof setInterval> | null = null;

async function expireOffers(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = await db.queryAsync<{ match_slug: string; short_side: string }>(
    // Only for the match's current load: one an admin restarted since gets a new timer.
    `SELECT o.match_slug, o.short_side FROM match_walkover_offers o
       JOIN matches m ON m.slug = o.match_slug AND m.loaded_at = o.loaded_at
      WHERE o.decided IS NULL AND o.expires_at <= ? AND m.status = 'loaded'`,
    [now]
  );
  for (const o of due) await decideWalkover(o.match_slug, true, 'platform:full-team');
}

async function tick(): Promise<void> {
  await expireOffers();
  const rows = await db.queryAsync<{
    slug: string;
    server_id: string;
    load_id: number;
    loaded_at: number;
    config: string | null;
    settings: string | null;
  }>(
    `SELECT m.slug, m.server_id, m.loaded_at AS load_id,
            GREATEST(m.loaded_at, COALESCE(m.countdown_from, 0)) AS loaded_at, m.config, t.settings
       FROM matches m JOIN tournament t ON t.id = m.tournament_id
      WHERE m.status = 'loaded' AND m.server_id IS NOT NULL AND m.loaded_at IS NOT NULL
        AND t.type <> 'shuffle' AND ${notHeldSql('m')}
        AND NOT EXISTS (SELECT 1 FROM match_walkover_offers o WHERE o.match_slug = m.slug AND o.loaded_at = m.loaded_at)`
  );
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  for (const row of rows) {
    const minutes = botsPlay(row.config) ? 0 : fullTeamMinutesOf(row.settings);
    if (minutes <= 0) continue;
    const key = `${row.slug}@${row.loaded_at}`;
    seen.add(key);
    const state = sent.get(key) ?? { warned120: false, warned30: false, done: false };
    sent.set(key, state);
    if (state.done) continue;
    const left = Number(row.loaded_at) + minutes * 60 - now;
    const say = (text: string) =>
      runFleetCommand(row.server_id, 'say', { text, as_admin: true }, ISSUED_BY).catch(
        () => undefined
      );
    if (left > 0) {
      if (left <= 30 && !state.warned30) {
        state.warned30 = true;
        void say(
          '30 seconds to have a full team on the server, or the other team may take a walkover.'
        );
      } else if (left <= 120 && !state.warned120) {
        state.warned120 = true;
        void say(
          '2 minutes to have a full team on the server, or the other team may take a walkover.'
        );
      }
      continue;
    }
    state.done = true;
    // The platform restarted after the match loaded: who joined before is not known, so no walkover.
    if (Math.floor(Date.now() / 1000 - process.uptime()) > Number(row.loaded_at)) continue;
    const size = (() => {
      try {
        return (
          Number(
            (JSON.parse(row.config ?? '{}') as { players_per_team?: Untrusted }).players_per_team
          ) || 5
        );
      } catch {
        return 5;
      }
    })();
    const on = (side: 'team1' | 'team2') =>
      rosterOf(row.config, side).filter(
        ([id]) => playerConnectionService.connectionOf(row.slug, id).state === 'connected'
      ).length;
    const short = shortSides(on('team1'), on('team2'), size);
    if (!short.team1 && !short.team2) continue;
    if (short.team1 && short.team2) {
      // Decided by the admin: once they let the hold go, this load gets no second timer.
      await db.runAsync(
        `INSERT INTO match_walkover_offers (match_slug, short_side, expires_at, loaded_at, decided)
         VALUES (?, 'both', ?, ?, 'admin')
         ON CONFLICT (match_slug) DO UPDATE
           SET short_side = 'both', expires_at = EXCLUDED.expires_at,
               loaded_at = EXCLUDED.loaded_at, decided = 'admin'`,
        [row.slug, now, row.load_id]
      );
      await holdMatch(row.slug, { minutes: null, reason: 'Both teams are short' }, ACTOR);
      const { adminNoticeService } = await import('../../../services/adminNoticeService');
      await adminNoticeService.raise(
        'teams_short',
        { matchSlug: row.slug },
        `teams_short:${row.slug}`
      );
      void say('Both teams are short. An admin decides.');
      continue;
    }
    const side = short.team1 ? 'team1' : 'team2';
    await db.runAsync(
      `INSERT INTO match_walkover_offers (match_slug, short_side, expires_at, loaded_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (match_slug) DO UPDATE
         SET short_side = EXCLUDED.short_side, expires_at = EXCLUDED.expires_at,
             loaded_at = EXCLUDED.loaded_at, decided = NULL`,
      [row.slug, side, now + CHOICE_S, row.load_id]
    );
    // Held until the choice: a hold that ran out with the offer let auto-start go live as it closed.
    await holdMatch(row.slug, { minutes: null, reason: 'Waiting for the walkover choice' }, ACTOR);
    const name = (s: 'team1' | 'team2') => {
      try {
        const c = JSON.parse(row.config ?? '{}') as Partial<Record<string, { name?: Untrusted }>>;
        return String(c[s]?.name ?? s);
      } catch {
        return s;
      }
    };
    void say(
      `${name(side)} is short. Captain of ${name(side === 'team1' ? 'team2' : 'team1')}: choose on screen (or type .walkover / .play). ${CHOICE_S / 60} minutes, then the walkover stands.`
    );
  }
  for (const key of [...sent.keys()]) if (!seen.has(key)) sent.delete(key);
}

export function startFullTeam(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error: unknown) => log.warn('[FULL TEAM] tick failed', { error: String(error) }));
  }, TICK_MS);
  timer.unref();
}
