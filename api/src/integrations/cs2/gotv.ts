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
 * - A tournament can set its own delay, seats and "insecure observers"
 *   (`settings.cs2.broadcast`, Manage › Settings); the site's are the default.
 *   Insecure observers (HUD tools like LHM that read GOTV) add
 *   `tv_secure_bypass 1` and `sv_deltaticks_enforce 0`, cvars every server
 *   applies, so it works without Ready Up's `tv` plugin.
 * - The live table on the match page follows `gotv_live_stats` for people who
 *   do not play in the match: the GOTV delay, live, or off
 *   (services/matchLiveStatsService delayed snapshots).
 */
import crypto from 'crypto';
import { settingsService } from '../../services/settingsService';
import { purposeKey } from '../../utils/secretBox';
import { db } from '../../config/database';
import { storedCs2Settings, type Cs2BroadcastSettings } from './tournamentSettings';

export interface GotvSettings {
  enabled: boolean;
  /** Seconds behind the players (tv_delay), 0–120. */
  delay: number;
  seats: number;
  access: 'everyone' | 'signed_in' | 'admins';
  liveStats: 'delayed' | 'live' | 'off';
  /** HUD tools (LHM) may connect to GOTV: tv_secure_bypass. Only a tournament turns it on. */
  insecureObservers: boolean;
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
    insecureObservers: false,
  };
}

/** The site's GOTV settings with a tournament's own (`settings.cs2.broadcast`) on top. */
export function withBroadcast(
  site: GotvSettings,
  broadcast: Cs2BroadcastSettings | undefined
): GotvSettings {
  if (!broadcast) return site;
  const delay = broadcast.delay;
  const seats = broadcast.seats;
  return {
    ...site,
    delay: Number.isInteger(delay) && delay! >= 0 && delay! <= 120 ? delay! : site.delay,
    seats: Number.isInteger(seats) && seats! >= 1 && seats! <= 100 ? seats! : site.seats,
    insecureObservers: broadcast.insecureObservers === true,
  };
}

/** A match's GOTV settings: the site's, and its tournament's own where it has them. */
export async function matchGotvSettings(slug: string): Promise<GotvSettings> {
  const row = await db
    .queryOneAsync<{ settings: string | null }>(
      'SELECT t.settings FROM matches m JOIN tournament t ON t.id = m.tournament_id WHERE m.slug = ?',
      [slug]
    )
    .catch(() => null);
  return withBroadcast(await gotvSettings(), storedCs2Settings(row?.settings)?.broadcast);
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

/** HUD tools (LHM) read GOTV: let them in, and keep the engine from dropping their ticks. */
export const INSECURE_OBSERVER_CVARS = { tv_secure_bypass: 1, sv_deltaticks_enforce: 0 } as const;

/**
 * The cvars a match config carries for GOTV (no delay in simulation, which
 * sets its own). `broadcast`: the tournament's own settings.
 */
export async function gotvCvars(
  slug: string,
  opts: { simulation?: boolean; onStage?: boolean; broadcast?: Cs2BroadcastSettings } = {}
): Promise<Record<string, string | number>> {
  const s = withBroadcast(await gotvSettings(), opts.broadcast);
  const password = await gotvPassword(slug);
  const insecure = s.insecureObservers ? INSECURE_OBSERVER_CVARS : {};
  if (!s.enabled) return { tv_password: password, ...insecure };
  return {
    ...(opts.simulation ? {} : { tv_delay: s.delay }),
    tv_maxclients: opts.onStage ? 128 : s.seats,
    tv_password: password,
    ...insecure,
  };
}

/**
 * Where a server's GOTV is: its port (the server's `host.tv_port`) and the
 * hosts to reach it, LAN and public when the machine has both
 * (fleet/connectChoice), with the one this viewer should use. Null without a port.
 */
export async function gotvHosts(
  serverId: string,
  viewerIp: string | null
): Promise<{
  port: number;
  options: Array<{ kind: 'lan' | 'public' | 'server'; host: string }>;
  recommended: string | null;
} | null> {
  const row = await db.queryOneAsync<{ fleet_server_id: string | null; host: string | null }>(
    'SELECT fleet_server_id, host FROM cs2_servers WHERE id = ?',
    [serverId]
  );
  const { getFleetServer } = await import('./fleet/registry');
  const fleet = await getFleetServer(row?.fleet_server_id ?? serverId);
  let port: number | null = null;
  try {
    const host = fleet?.host ? (JSON.parse(fleet.host) as { tv_port?: number }) : null;
    port = typeof host?.tv_port === 'number' ? host.tv_port : null;
  } catch {
    port = null;
  }
  if (!port) return null;
  const { connectChoice } = await import('./fleet/connectChoice');
  const choice = await connectChoice(serverId, viewerIp).catch(() => null);
  if (choice) {
    const chosen = choice.options.find((o) => o.kind === choice.recommended);
    return {
      port,
      options: choice.options.map((o) => ({ kind: o.kind, host: o.host })),
      recommended: chosen?.host ?? null,
    };
  }
  return row?.host
    ? { port, options: [{ kind: 'server', host: row.host }], recommended: row.host }
    : { port, options: [], recommended: null };
}
