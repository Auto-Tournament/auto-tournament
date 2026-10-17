/**
 * The match chat, bridged to the Ready Up server playing the match:
 *
 * - in: a player's chat line in game (`event.chat`) goes into the match's chat
 *   on the site (`match:<slug>`), where the admins read it. Ready Up commands
 *   (`.ready`, `!pause`) stay out.
 * - out: an admin's message in that chat is said on the server:
 *   `cmd say {text, from, as_admin}`. Players' messages from the site are not
 *   (Ready Up shows `from` as an admin's name). Lines from the game never go
 *   back out (they do not pass the chat service's `matchChatPosted`), so
 *   nothing loops.
 * - an admin call taken on or resolved is said in game too, so the player
 *   knows someone is on it.
 *
 * Only while the match is loaded or live on a fleet server. Fire and forget: a
 * message is posted on the site whatever the server makes of it. A server on a
 * Ready Up without `from` still says the text; one that refuses `say` (or is
 * gone) is logged and skipped.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import {
  onMatchChatPosted,
  postGameChatMessage,
  type MatchChatPosted,
} from '../../../services/socketService';
import { onAdminCallChanged, type AdminCallChange } from '../../../services/adminCallService';
import { fleetInbound, type FleetEventNotice } from './inbound';
import { runFleetCommand, type IssuedBy } from './driver';
import { fleetServerIdOf } from './link';
import { sayInGame } from './gameMessages';
import type { FleetEventData } from './protocol/v1';

/** What Ready Up's say takes per line. */
const SAY_MAX_BYTES = 190;
/** A long message is said in at most this many lines. */
const SAY_MAX_LINES = 3;

/** A Ready Up chat command, not chat: `.ready`, `!gg`. */
const COMMAND = /^[.!][a-z]/i;

/** The match's server while the match is loaded or live there (its cs2_servers id), else null. */
async function liveServerOf(slug: string): Promise<string | null> {
  const row = await db.queryOneAsync<{ server_id: string | null }>(
    "SELECT server_id FROM matches WHERE slug = ? AND status IN ('loaded', 'live')",
    [slug]
  );
  return row?.server_id ?? null;
}

/** `text` cut into lines of at most `maxBytes` (UTF-8), at a space where there is one. */
export function sayLines(text: string, maxBytes = SAY_MAX_BYTES, maxLines = SAY_MAX_LINES) {
  const lines: string[] = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest && lines.length < maxLines) {
    if (Buffer.byteLength(rest, 'utf8') <= maxBytes) {
      lines.push(rest);
      rest = '';
      break;
    }
    let cut = rest.length;
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > maxBytes - 3) cut--;
    const space = rest.lastIndexOf(' ', cut);
    if (space > cut / 2) cut = space;
    lines.push(`${rest.slice(0, cut).trimEnd()}…`);
    rest = rest.slice(cut).trimStart();
  }
  return lines;
}

/** Servers told once that they refused say (an old Ready Up), so the log says it once. */
const refused = new Set<string>();

async function relay(posted: MatchChatPosted): Promise<void> {
  if (posted.senderKind !== 'admin') return;
  const serverId = await liveServerOf(posted.slug);
  if (!serverId) return;
  const from = posted.senderName.slice(0, 64);
  const issuedBy: IssuedBy = { userId: 'platform:chat', name: from, root: false };
  for (const text of sayLines(posted.body)) {
    const outcome = await runFleetCommand(
      serverId,
      'say',
      { text, from, as_admin: true },
      issuedBy
    );
    if (outcome.ok) continue;
    // Not a fleet server (RCON): nothing to say it with.
    if (outcome.status === 'not_sent' && outcome.httpStatus === 404) return;
    if (!refused.has(serverId)) {
      refused.add(serverId);
      log.warn(
        `[CHAT BRIDGE] ${posted.slug}: ${serverId} did not say a chat message (${outcome.errorCode ?? outcome.status}); ` +
          'the chat on the site still has it. An older Ready Up may not take say from the platform.',
        { error: outcome.error }
      );
    } else {
      log.debug(`[CHAT BRIDGE] ${posted.slug}: say not run on ${serverId}`, {
        status: outcome.status,
        errorCode: outcome.errorCode,
      });
    }
    return;
  }
  refused.delete(serverId);
}

function onEvent(notice: FleetEventNotice): void {
  if (notice.envelope.type !== 'event.chat') return;
  // A redelivered line (after a reconnect or a platform restart) was posted the first time.
  if (notice.patch === 'duplicate') return;
  // Taken whatever the epoch, like an admin call: the players are talking now.
  const payload = notice.envelope.payload as {
    match_id: string;
    data: FleetEventData['chat'];
  };
  const data = payload.data;
  const message = (data?.message ?? '').trim();
  if (!message || COMMAND.test(message)) return;
  void postGameChatMessage(payload.match_id, {
    steamId: data.player.steamid64,
    name: data.player.name,
    team: data.player.team,
    teamOnly: data.team_only === true,
    body: message,
  }).catch((error: unknown) =>
    log.warn(`[CHAT BRIDGE] ${payload.match_id}: an in-game chat line was not posted`, {
      error: String(error),
    })
  );
}

async function onCallChanged(change: AdminCallChange): Promise<void> {
  const slug = change.call.matchSlug;
  if (!slug) return;
  const serverId = await liveServerOf(slug);
  const fleetServerId = serverId ? await fleetServerIdOf(serverId) : null;
  if (!fleetServerId) return;
  if (change.kind === 'claimed') {
    await sayInGame(fleetServerId, 'adminClaimed', { name: change.call.claimedByName });
  } else {
    await sayInGame(fleetServerId, 'adminResolved');
  }
}

let stops: Array<() => void> = [];

export function startChatBridge(): void {
  if (stops.length) return;
  stops = [
    fleetInbound.onEvent(onEvent),
    onMatchChatPosted((posted) => {
      void relay(posted).catch((error: unknown) =>
        log.debug(`[CHAT BRIDGE] ${posted.slug}: not relayed`, { error: String(error) })
      );
    }),
    onAdminCallChanged((change) => {
      void onCallChanged(change).catch((error: unknown) =>
        log.debug('[CHAT BRIDGE] admin call notice not said', { error: String(error) })
      );
    }),
  ];
}

export function stopChatBridge(): void {
  stops.forEach((stop) => stop());
  stops = [];
}
