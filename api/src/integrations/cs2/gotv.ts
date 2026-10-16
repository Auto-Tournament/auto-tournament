/**
 * Spectators in GOTV (Manage › Match rules › Spectators): anyone allowed can
 * join a match's GOTV from its match room and watch in CS2, `gotv_delay`
 * seconds behind the players so nobody can ghost.
 *
 * - The match config sets `tv_delay`, `tv_maxclients` (the seats; a match on
 *   stage gets all of them) and `tv_password`. The password is the same every
 *   time the config is built (an HMAC of the slug with a key derived from the
 *   instance's secrets key, utils/secretBox purposeKey) and is only handed to viewers who may watch, so GOTV is closed to
 *   everyone else even with its port open. With spectators off it is set too.
 * - csm gives each server its own GOTV port (the server's `host.tv_port`).
 * - The live table on the match page follows `gotv_live_stats` for people who
 *   do not play in the match: the GOTV delay, live, or off
 *   (services/matchLiveStatsService delayed snapshots).
 */
import crypto from 'crypto';
import { settingsService } from '../../services/settingsService';
import { purposeKey } from '../../utils/secretBox';

export interface GotvSettings {
  enabled: boolean;
  /** Seconds behind the players (tv_delay), 0–120. */
  delay: number;
  seats: number;
  access: 'everyone' | 'signed_in' | 'admins';
  liveStats: 'delayed' | 'live' | 'off';
}

const ACCESS = ['everyone', 'signed_in', 'admins'] as const;
const STATS = ['delayed', 'live', 'off'] as const;

function int(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export async function gotvSettings(): Promise<GotvSettings> {
  const [enabled, delay, seats, access, stats] = await Promise.all(
    ['gotv_spectators', 'gotv_delay', 'gotv_seats', 'gotv_access', 'gotv_live_stats'].map((k) =>
      settingsService.getSetting(k)
    )
  );
  return {
    // On unless turned off: csm runs GOTV on every server anyway (demos).
    enabled: enabled !== '0',
    delay: int(delay, 105, 0, 120),
    seats: int(seats, 8, 1, 128),
    access: ACCESS[int(access, 0, 0, 2)],
    liveStats: STATS[int(stats, 0, 0, 2)],
  };
}

/** The fields GET /api/settings answers with (settingsReaders). */
export async function gotvSettingsResponse(): Promise<Record<string, number>> {
  const s = await gotvSettings();
  return {
    gotvSpectators: s.enabled ? 1 : 0,
    gotvDelay: s.delay,
    gotvSeats: s.seats,
    gotvAccess: ACCESS.indexOf(s.access),
    gotvLiveStats: STATS.indexOf(s.liveStats),
  };
}

/** The match's GOTV password: the same every time for one match. */
export async function gotvPassword(slug: string): Promise<string> {
  return crypto.createHmac('sha256', purposeKey('gotv')).update(slug).digest('hex').slice(0, 12);
}

/** The cvars a match config carries for GOTV (none in simulation, which sets its own delay). */
export async function gotvCvars(
  slug: string,
  opts: { simulation?: boolean; onStage?: boolean } = {}
): Promise<Record<string, string | number>> {
  const s = await gotvSettings();
  const password = await gotvPassword(slug);
  if (!s.enabled) return { tv_password: password };
  return {
    ...(opts.simulation ? {} : { tv_delay: s.delay }),
    tv_maxclients: opts.onStage ? 128 : s.seats,
    tv_password: password,
  };
}
