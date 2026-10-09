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
 * The standing comes from the key itself (checked offline) and the last
 * check-in answer (./checkin.ts), so a short outage on the license server's
 * side changes nothing: the last answer and the key's own dates hold. A
 * monthly key whose last paid day is more than 14 days ago is expired even
 * offline; check-ins bring the renewed key.
 */

import { verifyLicense, type LicensePayload } from './verify';
import type { LicensePublicKey } from './publicKeys';

export const GRACE_DAYS = 14;

/** What the license server last said about the license (the check-in answer's `license`). */
export interface ServerLicenseState {
  status: 'active' | 'past_due' | 'expired' | 'revoked' | 'replaced';
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
  /** YYYY-MM-DD: the day the platform stops unless paid; null when nothing stops. */
  stopsOn: string | null;
}

const FREE: LicenseStanding = { status: 'free', paid: false, maxServers: null, licenseId: null, stopsOn: null };

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

/** Pure: the standing for a stored key and the last check-in answer, on `today` (YYYY-MM-DD). */
export function standingFor(
  key: string | null,
  server: ServerLicenseState | null,
  today: string,
  publicKeys?: Readonly<Record<string, LicensePublicKey>>
): LicenseStanding {
  if (!key) return FREE;
  const check = verifyLicense(key, { now: today, ...(publicKeys ? { publicKeys } : {}) });
  if (!check.valid || !check.license) return { ...FREE, status: 'invalid' };
  const license = check.license;
  const local = offline(license, today);
  let status: 'active' | 'past_due' | 'expired' = local.status as 'active' | 'past_due' | 'expired';
  let stopsOn = local.stopsOn;
  if (server && (server.status === 'past_due' || server.status === 'expired')) {
    if (rank[server.status] > rank[status]) status = server.status;
    stopsOn = server.stopsOn ?? stopsOn;
  }
  // The server only ever makes it stricter, except that a renewal it confirmed (a newer key) is picked up by replacing the key itself.
  return { status, paid: true, maxServers: license.max_servers, licenseId: license.id, stopsOn };
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
    throw new LicenseLimitError('license_expired', 'The license has expired. Pay it in the console to create servers again.');
  }
  if (standing.maxServers !== null && current + adding > standing.maxServers) {
    throw new LicenseLimitError(
      'server_limit',
      `Your license covers ${standing.maxServers} game server${standing.maxServers === 1 ? '' : 's'} and ${current} ${current === 1 ? 'is' : 'are'} set up. Add servers to your license in the console to create more.`
    );
  }
}
