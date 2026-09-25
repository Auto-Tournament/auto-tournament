/**
 * Reading Ready Up's `admin_called` event (a player typed `.admin [message]`).
 * Pure: no database, so it can be tested on its own. `adminCalled.ts` adds the
 * server and match the pipeline attributed the request to.
 *
 * Lenient on purpose: a call with an odd field is still a player asking for
 * help, so a field that cannot be read becomes null rather than a rejection.
 */

import crypto from 'crypto';
import {
  ADMIN_CALL_MESSAGE_MAX,
  type AdminCallInput,
  type AdminCallTeam,
} from '../../../types/adminCall.types';
import type { AdminCalledEvent } from './plugin-events.types';

export type AdminCalledFields = Omit<
  AdminCallInput,
  'serverId' | 'serverName' | 'matchId' | 'matchSlug'
>;

function text(value: unknown, max: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function team(value: unknown): AdminCallTeam | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'team1' || v === 'team2' || v === 'spectator' ? v : null;
}

function side(value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'ct' || v === 't' ? v : null;
}

/** ISO 8601 → epoch seconds; `receivedAt` when missing or unreadable. */
function calledAtSeconds(value: unknown, receivedAt: number): number {
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return receivedAt;
}

/** Everything the event itself says. `receivedAt` is epoch seconds. */
export function readAdminCalled(event: AdminCalledEvent, receivedAt: number): AdminCalledFields {
  const player = event.player && typeof event.player === 'object' ? event.player : null;
  const message =
    typeof event.message === 'string' ? event.message.trim().slice(0, ADMIN_CALL_MESSAGE_MAX) : '';
  const mapNumber =
    typeof event.map_number === 'number' &&
    Number.isInteger(event.map_number) &&
    event.map_number >= 0
      ? event.map_number
      : null;
  const steamId = text(player?.steamid64, 32);

  // Ready Up sends a unique call_id. Without one, a stable id from what the
  // call says, so a retried delivery still lands once.
  const callId =
    text(event.call_id, 128) ??
    `derived:${crypto
      .createHash('sha256')
      .update(JSON.stringify([event.matchid ?? null, steamId, message, event.called_at ?? null]))
      .digest('hex')
      .slice(0, 32)}`;

  return {
    callId,
    game: 'cs2',
    mapNumber,
    player: {
      steamId,
      name: text(player?.name, 128),
      team: team(player?.team),
      side: side(player?.side),
    },
    message,
    calledAt: calledAtSeconds(event.called_at, receivedAt),
  };
}
