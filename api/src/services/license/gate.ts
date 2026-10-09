/**
 * Where this install's license stands, and the two things that follow from
 * it (Commercial License Terms, sections 4 and 8):
 *
 * - **The server limit.** With a paid license key, no game server is created
 *   above the key's `max_servers`, however it is asked for (an admin, CS2
 *   Server Manager, auto-scaling, failover). Running servers and matches are
 *   never stopped. Without a key (free non-commercial use) there is no limit.
 * - **Late payment.** A monthly or yearly license that isn't paid is
 *   `past_due` (admins see a warning) and, after 14 days of grace, `expired`:
 *   the platform stops for everyone until it is paid.
 *
 * - **One key, one install.** The license server binds a key to the first
 *   platform install that checks in with it; another gets
 *   `in_use_elsewhere` and stops at once.
 * - **A replaced key.** After "Get a new key" in the console the old key is
 *   `replaced`: admins see a warning and get a day to paste the new key,
 *   then it stops.
 *
 * The standing comes from the key itself (checked offline), the lease (the
 * license's current terms, signed, from the last check-in: the key never
 * changes on renewal or more servers) and the last check-in answer
 * (./checkin.ts), so a short outage on the license server's side changes
 * nothing. A monthly license whose last paid day is more than 14 days ago is
 * expired even offline; check-ins bring the lease that moves it on.
 */

import { verifyLicense, type LicensePayload } from './verify';
import type { LicensePublicKey } from './publicKeys';

export const GRACE_DAYS = 14;

/** What the license server last said about the license (the check-in answer's `license`). */
export interface ServerLicenseState {
  status: 'active' | 'past_due' | 'expired' | 'revoked' | 'replaced' | 'in_use_elsewhere';
  validUntil: string | null;
  stopsOn: string | null;
}

export interface LicenseStanding {
  /** free: no key. invalid: a key that isn't genuine (treated as no key, never enforced). */
  status: 'free' | 'invalid' | 'active' | 'past_due' | 'expired';
  /** A genuine key: its server limit applies. */
  paid: boolean;
  maxServers: number | null;
  licenseId: string | null;
  /** YYYY-MM-DD: the day the platform stops unless sorted; null when nothing stops. */
  stopsOn: string | null;
  /** Why it is past due or expired: not paid, the key was replaced by a new one, or the key belongs to another install. */
  reason: 'unpaid' | 'replaced' | 'in_use_elsewhere' | null;
  /**
   * Servers other installs (csm hosts, another platform) use on this license,
   * from the last check-in: the limit is one pool for the whole license.
   */
  serversElsewhere?: number;
}

const FREE: LicenseStanding = { status: 'free', paid: false, maxServers: null, licenseId: null, stopsOn: null, reason: null };

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The offline rule for a subscription key: valid until its last paid day, then grace, then expired. */
function offline(license: LicensePayload, today: string): Pick<LicenseStanding, 'status' | 'stopsOn'> {
  if (license.kind !== 'month') return { status: 'active', stopsOn: null };
  const stopsOn = addDays(license.updates_until, GRACE_DAYS);
  if (today > stopsOn) return { status: 'expired', stopsOn };
  if (today > license.updates_until) return { status: 'past_due', stopsOn };
  return { status: 'active', stopsOn: null };
}

const rank = { active: 0, past_due: 1, expired: 2 } as const;

/** Pure: the standing for a stored key, the last check-in answer and the stored lease, on `today` (YYYY-MM-DD). */
export function standingFor(
  key: string | null,
  server: ServerLicenseState | null,
  today: string,
  publicKeys?: Readonly<Record<string, LicensePublicKey>>,
  lease?: string | null
): LicenseStanding {
  if (!key) return FREE;
  const opts = { now: today, ...(publicKeys ? { publicKeys } : {}) };
  const check = verifyLicense(key, opts);
  // A lease is never the key: pasted as one, it counts as no genuine key.
  if (!check.valid || !check.license || check.license.lease) return { ...FREE, status: 'invalid' };
  let license = check.license;
  // The current terms: a genuine lease of the same license, issued no earlier than the key.
  if (lease) {
    const l = verifyLicense(lease, opts);
    if (l.valid && l.license && l.license.lease === true && l.license.id === license.id && l.license.kind === license.kind && l.license.issued_at >= license.issued_at) {
      license = l.license;
    }
  }
  const base = { paid: true, maxServers: license.max_servers, licenseId: license.id } as const;

  if (server?.status === 'in_use_elsewhere') return { ...base, status: 'expired', stopsOn: server.stopsOn ?? today, reason: 'in_use_elsewhere' };
  if (server?.status === 'replaced') {
    const stopsOn = server.stopsOn ?? today;
    return { ...base, status: today > stopsOn ? 'expired' : 'past_due', stopsOn, reason: 'replaced' };
  }

  const local = offline(license, today);
  let status: 'active' | 'past_due' | 'expired' = local.status as 'active' | 'past_due' | 'expired';
  let stopsOn = local.stopsOn;
  // An answer about an earlier period than the lease covers (paid since) doesn't count.
  const stale = server?.validUntil && server.validUntil < license.updates_until;
  if (server && !stale && (server.status === 'past_due' || server.status === 'expired')) {
    if (rank[server.status] > rank[status]) status = server.status;
    stopsOn = server.stopsOn ?? stopsOn;
  }
  return { ...base, status, stopsOn, reason: status === 'active' ? null : 'unpaid' };
}

export class LicenseLimitError extends Error {
  readonly statusCode = 402;
  readonly code: 'server_limit' | 'license_expired';
  constructor(code: 'server_limit' | 'license_expired', message: string) {
    super(message);
    this.code = code;
    this.name = 'LicenseLimitError';
  }
}

/**
 * Throws when creating `adding` more game servers would go above the paid
 * limit, or the license has expired. `current` is the servers set up now.
 */
export function checkCreate(standing: LicenseStanding, current: number, adding = 1): void {
  if (!standing.paid) return;
  if (standing.status === 'expired') {
    throw new LicenseLimitError('license_expired', expiredMessage(standing));
  }
  const elsewhere = standing.serversElsewhere ?? 0;
  if (standing.maxServers !== null && current + elsewhere + adding > standing.maxServers) {
    const inUse = current + elsewhere;
    throw new LicenseLimitError(
      'server_limit',
      `Your license covers ${standing.maxServers} game server${standing.maxServers === 1 ? '' : 's'} and ${inUse} ${inUse === 1 ? 'is' : 'are'} set up${elsewhere > 0 ? ` (${elsewhere} of them on other installs using this key)` : ''}. Add servers to your license in the console to create more.`
    );
  }
}

/** What to tell people when the license has stopped the platform. */
export function expiredMessage(standing: Pick<LicenseStanding, 'reason'>): string {
  if (standing.reason === 'in_use_elsewhere') {
    return 'This license key is in use on another Auto Tournament install. Use "Move to another install" in the console, or paste this install\'s own key.';
  }
  if (standing.reason === 'replaced') return 'This license key was replaced by a new one in the console. Paste the new key under Settings, then License.';
  return 'The license has expired. Pay it in the console to create servers again.';
}
