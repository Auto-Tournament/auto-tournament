/**
 * A player's own display name (`/api/me/name`), when the site lets players
 * choose it (setting `players_choose_name`). The name is the one shown on the
 * site and sent to game servers (Ready Up's roster) at the next match assign.
 *
 * Admins can always rename anyone (PUT /api/players/:id); this is only the
 * player's own path, and it is rate-limited to one change a day.
 */

import { db } from '../config/database';
import { playerService } from './playerService';
import { settingsService } from './settingsService';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 32;
/** How long after a change the player must wait before changing it again. */
export const NAME_CHANGE_INTERVAL_SECONDS = 24 * 60 * 60;

// Control and format characters (CS2 chat colours are control bytes), and
// the characters Ready Up strips from names anyway.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>]/u;

/** A trimmed, valid name, or why the name is refused. */
export function validateDisplayName(
  raw: unknown
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'name must be a string' };
  const name = raw.trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      error: `Name must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} characters`,
    };
  }
  if (FORBIDDEN.test(name)) {
    return { ok: false, error: 'Name cannot contain control characters, quotes or < >' };
  }
  return { ok: true, name };
}

export interface OwnNameState {
  name: string;
  /** Whether players may choose their name on this site. */
  enabled: boolean;
  /** Ask the player for their name: on, and never confirmed. */
  showPrompt: boolean;
  /** Epoch seconds when they may change it again; null = now. */
  nextChangeAt: number | null;
}

async function readRow(steamId: string) {
  return db.queryOneAsync<{
    name: string;
    name_confirmed_at: number | null;
    name_changed_at: number | null;
  }>(
    'SELECT name, name_confirmed_at, name_changed_at FROM players WHERE id = ? AND deleted_at IS NULL',
    [steamId]
  );
}

function nextChangeAt(changedAt: number | null, now: number): number | null {
  if (changedAt === null) return null;
  const next = Number(changedAt) + NAME_CHANGE_INTERVAL_SECONDS;
  return next > now ? next : null;
}

export async function getOwnNameState(steamId: string): Promise<OwnNameState | null> {
  const row = await readRow(steamId);
  if (!row) return null;
  const enabled = await settingsService.canPlayersChooseName();
  return {
    name: row.name,
    enabled,
    showPrompt: enabled && row.name_confirmed_at === null,
    nextChangeAt: enabled ? nextChangeAt(row.name_changed_at, Math.floor(Date.now() / 1000)) : null,
  };
}

export class NameChangeError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Save (or confirm) the player's own name. Keeping the same name always
 * works, and confirms it; a different name works once a day.
 */
export async function setOwnName(steamId: string, raw: unknown): Promise<OwnNameState> {
  if (!(await settingsService.canPlayersChooseName())) {
    throw new NameChangeError(403, 'Players cannot change their name on this site');
  }
  const valid = validateDisplayName(raw);
  if (!valid.ok) throw new NameChangeError(400, valid.error);
  const row = await readRow(steamId);
  if (!row) throw new NameChangeError(404, 'No player record for this account');

  const now = Math.floor(Date.now() / 1000);
  const changed = valid.name !== row.name;
  if (changed && nextChangeAt(row.name_changed_at, now) !== null) {
    throw new NameChangeError(429, 'You can change your name once a day');
  }
  if (changed) await playerService.updatePlayer(steamId, { name: valid.name });
  // Only a change starts the day's wait: confirming the same name never does.
  await db.runAsync(
    `UPDATE players SET name_confirmed_at = COALESCE(name_confirmed_at, ?),
       name_changed_at = CASE WHEN ? THEN ? ELSE name_changed_at END WHERE id = ?`,
    [now, changed, now, steamId]
  );
  return (await getOwnNameState(steamId))!;
}
