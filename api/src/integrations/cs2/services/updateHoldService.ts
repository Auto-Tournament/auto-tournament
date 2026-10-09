/**
 * Should a game host pause its automatic CS2 updates right now?
 *
 * CS2 Server Manager (csm) auto-updates a server once it has been idle for a
 * grace period. Idle is a local judgement — no players, no match loaded — and
 * it is right up until the moment MAT allocates that server the next match of
 * a tournament. A server that restarts for a Valve update in the two minutes
 * between two rounds is indistinguishable, from the players' side, from a
 * server that fell over.
 *
 * MAT is the only party that knows a tournament is running, so it answers the
 * question and csm asks it (`GET /api/servers/update-hold`). Nothing is pushed:
 * see the route for why.
 *
 * The answer is fleet-wide on purpose. MAT runs one tournament at a time
 * (`tournament` is a single row) and its allocator may hand *any* enabled
 * server the next match, so "is a tournament live on the servers you manage"
 * has the same answer for every host while that tournament is in progress.
 * Scoping the reply to one host's own addresses would need csm to know its
 * public address and MAT to match it — a new failure mode for no gain.
 */

import { createHash } from 'crypto';
import { db } from '../../../config/database';
import { settingsService } from '../../../services/settingsService';
import { ACTIVE_MATCH_STATUSES } from '../../../utils/serverAttribution';

/** A match MAT considers to be running on a server right now. */
export interface ActiveMatchRow {
  slug: string;
  serverId: string | null;
  status: string;
}

/** What the decision needs to know. Separate so it can be table-tested. */
export interface UpdateHoldInputs {
  /** `tournament.status`, or null when there is no tournament row yet. */
  tournamentStatus: string | null;
  /** `tournament.name`, for the reason string. */
  tournamentName: string | null;
  /** Matches in an active status (`loaded`, `live`). */
  activeMatches: readonly ActiveMatchRow[];
}

export interface UpdateHoldDecision {
  hold: boolean;
  /** One sentence, written to be pasted straight into csm's monitor log. */
  reason: string;
}

/** Tournament statuses during which servers must not restart themselves. */
export const HOLDING_TOURNAMENT_STATUSES: readonly string[] = ['in_progress'];

/** How many match slugs the reason string names before it summarises. */
const REASON_MATCH_LIMIT = 3;

/**
 * Decide the hold. Pure.
 *
 * A loaded or live match is checked first and independently of the tournament
 * status, so a manually started match still holds updates on an instance whose
 * tournament row sits in `setup`.
 */
export function decideUpdateHold(inputs: UpdateHoldInputs): UpdateHoldDecision {
  const active = inputs.activeMatches;
  if (active.length > 0) {
    const named = active
      .slice(0, REASON_MATCH_LIMIT)
      .map((match) => (match.serverId ? `${match.slug} on ${match.serverId}` : match.slug))
      .join(', ');
    const more =
      active.length > REASON_MATCH_LIMIT ? `, +${active.length - REASON_MATCH_LIMIT} more` : '';
    return {
      hold: true,
      reason: `${active.length} match(es) in progress (${named}${more})`,
    };
  }

  const status = inputs.tournamentStatus;
  if (status && HOLDING_TOURNAMENT_STATUSES.includes(status)) {
    const name = inputs.tournamentName?.trim();
    return {
      hold: true,
      reason:
        `tournament${name ? ` "${name}"` : ''} is in progress, ` +
        'so any enabled server may be given a match at any moment',
    };
  }

  return {
    hold: false,
    reason: status
      ? `no match is loaded or live and the tournament is "${status}"`
      : 'no match is loaded or live and there is no tournament',
  };
}

/** The decision plus the facts behind it, as the endpoint returns them. */
export interface UpdateHoldStatus extends UpdateHoldDecision {
  tournamentStatus: string | null;
  activeMatches: ActiveMatchRow[];
  checkedAt: number;
}

interface TournamentStatusRow {
  status: string | null;
  name: string | null;
}

interface ActiveMatchDbRow {
  slug: string;
  server_id: string | null;
  status: string;
}

/**
 * Read the facts out of the database and decide.
 *
 * Several tournaments can run at once and the allocator may hand any
 * enabled server a match of any of them, so the tournament that counts is
 * any running one; `tournamentId` (`resolveTournamentId(req)`) is the one
 * read when none is running, for the reason string.
 *
 * The active-match query is deliberately not scoped to that tournament: a
 * standalone match has no `tournament_id`, and a server running one must hold
 * updates just the same.
 */
export async function getUpdateHoldStatus(tournamentId: number): Promise<UpdateHoldStatus> {
  const placeholders = ACTIVE_MATCH_STATUSES.map(() => '?').join(', ');
  const [tournament, matches] = await Promise.all([
    db.queryOneAsync<TournamentStatusRow>(
      `SELECT status, name FROM tournament
        WHERE status = 'in_progress' OR id = ?
        ORDER BY (status = 'in_progress') DESC, id DESC LIMIT 1`,
      [tournamentId]
    ),
    db.queryAsync<ActiveMatchDbRow>(
      `SELECT slug, server_id, status FROM matches WHERE status IN (${placeholders}) ORDER BY slug`,
      [...ACTIVE_MATCH_STATUSES]
    ),
  ]);

  const activeMatches: ActiveMatchRow[] = matches.map((row) => ({
    slug: row.slug,
    serverId: row.server_id ?? null,
    status: row.status,
  }));

  const decision = decideUpdateHold({
    tournamentStatus: tournament?.status ?? null,
    tournamentName: tournament?.name ?? null,
    activeMatches,
  });

  return {
    ...decision,
    tournamentStatus: tournament?.status ?? null,
    activeMatches,
    checkedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * The license key csm gets on each poll, so it can write it into Ready Up's
 * `readyup_license_key` (`csm license set` / `csm license clear`) on every
 * server it manages.
 *
 * `revision` changes exactly when the stored key changes (saved, replaced or
 * cleared), so csm only rewrites configs when there is something new. It is a
 * short hash of the key, not a timestamp, so it survives restarts and needs no
 * storage of its own. `none` means no key is saved.
 */
export interface ServerLicenseHandoff {
  key: string | null;
  revision: string;
  /**
   * The license's current terms from the platform's last check-in (a signed
   * lease, same format as a key): the key never changes on renewal or more
   * servers, so csm and Ready Up take their limits from this. Left out when
   * there is none.
   */
  lease?: string;
  /**
   * Where the license stands, from the platform's last check-in: csm and
   * Ready Up stop with the platform when it is expired, replaced past its day,
   * or in use elsewhere. Left out when there is no answer yet.
   */
  state?: { status: string; stops_on: string | null; valid_until: string | null };
  /**
   * How the admin said this instance is used (the consent from the license
   * terms step), so csm can give Ready Up its license consent with no prompt.
   * Left out until an admin has accepted.
   */
  use?: 'noncommercial' | 'commercial';
}

export const NO_LICENSE_REVISION = 'none';

/**
 * The hand-off for a stored key (or none), with its lease and state. Pure.
 * The revision covers all three, so csm rewrites configs when any changes.
 */
/** Whether a key is a free key (kind 'free'): those stay with the platform. Reads the payload only; the platform checked the signature when it was saved. */
function isFreeKey(key: string): boolean {
  try {
    const part = key.split('.')[1];
    if (!part) return false;
    return (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { kind?: unknown }).kind === 'free';
  } catch {
    return false;
  }
}

export function licenseHandoffFor(
  key: string | null | undefined,
  lease?: string | null,
  state?: ServerLicenseHandoff['state'] | null
): ServerLicenseHandoff {
  const trimmed = key?.trim() || null;
  // No key, or a free key (non-commercial use: nothing for csm or Ready Up to enforce).
  if (!trimmed || isFreeKey(trimmed)) return { key: null, revision: NO_LICENSE_REVISION };
  const leaseValue = lease?.trim() || undefined;
  const material = [trimmed, leaseValue ?? '', state ? JSON.stringify(state) : ''].join('\n');
  const digest = createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16);
  return {
    key: trimmed,
    revision: `sha256:${digest}`,
    ...(leaseValue ? { lease: leaseValue } : {}),
    ...(state ? { state } : {}),
  };
}

/** The last check-in answer's license state (`license_checkin_result`, JSON), or null. */
async function checkinState(): Promise<ServerLicenseHandoff['state'] | null> {
  try {
    const raw = await settingsService.getSetting('license_checkin_result');
    const lic = raw ? (JSON.parse(raw) as { license?: { status?: unknown; stopsOn?: unknown; validUntil?: unknown } }).license : undefined;
    if (!lic || typeof lic.status !== 'string') return null;
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return { status: lic.status, stops_on: day(lic.stopsOn), valid_until: day(lic.validUntil) };
  } catch {
    return null;
  }
}

/**
 * The `use` of the stored consent (`license_consent`, JSON), or undefined
 * when there is none or it can't be read. Read through settingsService for the
 * same reason as the key: a code module can only import listed host modules,
 * and the consent service is not one.
 */
async function consentUse(): Promise<'noncommercial' | 'commercial' | undefined> {
  try {
    const raw = await settingsService.getSetting('license_consent');
    const use = raw ? (JSON.parse(raw) as { use?: unknown }).use : undefined;
    return use === 'noncommercial' || use === 'commercial' ? use : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The stored key (`license_key`, written only through /api/license) as csm
 * gets it. Passed through as stored: Ready Up checks it itself. Read through
 * settingsService rather than the license service so this module needs no
 * new host module.
 */
export async function getLicenseHandoff(): Promise<ServerLicenseHandoff> {
  const [key, lease, state] = await Promise.all([
    settingsService.getSetting('license_key'),
    settingsService.getSetting('license_lease'),
    checkinState(),
  ]);
  const handoff = licenseHandoffFor(key, lease, state);
  const use = await consentUse();
  if (use) handoff.use = use;
  return handoff;
}
