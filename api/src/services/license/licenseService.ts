/**
 * The instance's Auto Tournament license key: stored, checked offline
 * (./verify), and described for the admin UI.
 *
 * Free non-commercial use is legitimate and never limited: no key is a quiet
 * note for admins. A paid key's server limit is enforced when servers are
 * created, and an unpaid subscription stops the platform after its grace
 * period (./gate.ts); a problem with a key is a warning for admins. Players
 * see one line on public event pages (getPublicBadge): licensed for
 * commercial or non-profit use, or unlicensed.
 *
 * The key is stored in `app_settings` (`license_key`), set only through
 * /api/license. It is not a secret, but it is treated as sensitive: never
 * logged, never returned after saving (the admin sees the license id). The
 * one reader outside this service is the game hosts' update-hold poll
 * (integrations/cs2/services/updateHoldService.ts), which hands it to CS2
 * Server Manager for Ready Up, behind the server token.
 */

import { settingsService } from '../settingsService';
import packageJson from '../../../package.json';
import { buildLineDate } from './lineDate';
import { countServers } from './serverCount';
import {
  checkCreate,
  expiredMessage,
  LicenseLimitError,
  standingFor,
  type LicenseStanding,
} from './gate';
import {
  parseStoredResult,
  SETTING,
  type CheckinStatus,
  type EventPromptAction,
  type EventPromptStatus,
} from './checkin';
import type { LicensePublicKey } from './publicKeys';
import {
  decodeLicense,
  verifyLicense,
  LIFETIME,
  type LicenseCheck,
  type LicensePayload,
  type LicenseWarning,
} from './verify';

export const VERIFY_URL_BASE = 'https://autotournament.gg/verify/';
export const PRICING_URL = 'https://autotournament.gg/pricing';

/** What the admin UI shows about the license. Never the key itself. */
export interface LicenseStatus {
  /** `none`: no key saved (free non-commercial use). */
  status: 'none' | 'ok' | 'warning' | 'invalid';
  /** The saved key's details, when it is a genuine key. */
  license: {
    id: string;
    licensee: string | null;
    product: LicensePayload['product'];
    pack: LicensePayload['pack'];
    maxServers: number;
    kind: LicensePayload['kind'];
    issuedAt: string;
    /** YYYY-MM-DD, or null for a founder license (updates for life). */
    updatesUntil: string | null;
    validFrom: string | null;
    validTo: string | null;
  } | null;
  warnings: LicenseWarning[];
  /** The public check page for this license; null without a genuine key. */
  verifyUrl: string | null;
  pricingUrl: string;
  /** Game servers set up now; null when it could not be counted. */
  serverCount: number | null;
  /** This build's version and version line date (see ./lineDate). */
  version: string;
  lineDate: string;
  /**
   * The daily check-in (./checkin.ts): when it last went through, the
   * server's notice (a calm note, never a block) and what is sent. Null
   * without a key: then nothing is sent at all.
   */
  checkin: CheckinStatus | null;
  /** Where the license stands: free, active, past_due (admins see a warning) or expired (the platform stops). See ./gate.ts. */
  standing: LicenseStanding;
  /**
   * An event license only: whether to ask the admin, quietly, what the
   * activity outside the license's dates is (testing, a new event, moved
   * dates). Null for every other license.
   */
  eventPrompt: EventPromptStatus | null;
}

export interface StatusInputs {
  serverCount: number | null;
  lineDate: string;
  version: string;
  now?: string | Date;
  publicKeys?: Readonly<Record<string, LicensePublicKey>>;
}

/** The license id for the verify page. Only URL-safe characters, so the link can't be bent. */
export function verifyUrlFor(id: string): string {
  return `${VERIFY_URL_BASE}${encodeURIComponent(id)}`;
}

function describe(check: LicenseCheck): LicenseStatus['license'] {
  const p = check.license;
  if (!p) return null;
  return {
    id: p.id,
    licensee: p.licensee?.trim() || null,
    product: p.product,
    pack: p.pack,
    maxServers: p.max_servers,
    kind: p.kind,
    issuedAt: p.issued_at,
    updatesUntil: p.updates_until === LIFETIME ? null : p.updates_until,
    validFrom: p.valid_from ?? null,
    validTo: p.valid_to ?? null,
  };
}

/** The status for a stored key (or none). Pure: the inputs come from the caller. */
export function statusFor(key: string | null, inputs: StatusInputs): LicenseStatus {
  const base = {
    pricingUrl: PRICING_URL,
    serverCount: inputs.serverCount,
    version: inputs.version,
    lineDate: inputs.lineDate,
    checkin: null,
    eventPrompt: null,
    standing: {
      status: 'free',
      paid: false,
      maxServers: null,
      licenseId: null,
      stopsOn: null,
      reason: null,
      serversElsewhere: 0,
    } as LicenseStanding,
  };
  if (!key) {
    return { status: 'none', license: null, warnings: [], verifyUrl: null, ...base };
  }
  const check = verifyLicense(key, {
    product: 'platform',
    lineDate: inputs.lineDate,
    now: inputs.now,
    publicKeys: inputs.publicKeys,
    ...(inputs.serverCount === null ? {} : { serverCount: inputs.serverCount }),
  });
  const license = describe(check);
  return {
    status: check.status,
    license,
    warnings: check.warnings,
    verifyUrl: license ? verifyUrlFor(license.id) : null,
    ...base,
  };
}

/** Why a pasted key is refused before it is stored, or null to store it. */
export function keyInputProblem(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return 'Paste a license key';
  let payload: unknown;
  try {
    payload = decodeLicense(input).payload;
  } catch {
    return 'This is not an Auto Tournament license key (it starts with ATL1.)';
  }
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { lease?: unknown }).lease === true
  ) {
    return 'This is a lease, not a license key. Copy the key from the console.';
  }
  return null;
}

class LicenseService {
  async getKey(): Promise<string | null> {
    return (await settingsService.getSetting('license_key'))?.trim() || null;
  }

  /** Where the license stands now (./gate.ts): the key, read offline, the lease and the last check-in answer. */
  async standing(now: Date = new Date()): Promise<LicenseStanding> {
    const [key, stored, lease] = await Promise.all([
      this.getKey(),
      settingsService.getSetting(SETTING.result),
      settingsService.getSetting(SETTING.lease),
    ]);
    const result = parseStoredResult(stored ?? null);
    return {
      ...standingFor(
        key,
        result.license ?? null,
        now.toISOString().slice(0, 10),
        undefined,
        lease ?? null
      ),
      serversElsewhere: result.serversElsewhere ?? 0,
    };
  }

  /**
   * Checked before every new game server, however it is asked for: throws a
   * LicenseLimitError (402) above a paid key's limit or once it has expired.
   * Never for free use. Counting failures don't block (the limit can't be
   * known then).
   */
  async assertCanCreateServers(adding = 1): Promise<void> {
    const standing = await this.standing();
    if (!standing.paid) return;
    const current = (await countServers()) ?? 0;
    // The last check-in's view first: a stopped license, or clearly over.
    checkCreate(standing, current, adding);
    // Then the license server, for the whole license right now.
    const { licenseCheckin } = await import('./checkinService');
    const answer = await licenseCheckin.reserve(current, adding);
    if (answer.result === 'refused') {
      if (answer.reason === 'server_limit') {
        checkCreate(
          {
            ...standing,
            maxServers: answer.maxServers ?? standing.maxServers,
            serversElsewhere: answer.elsewhere,
          },
          current,
          adding
        );
        throw new LicenseLimitError(
          'server_limit',
          'Your license has no free servers left. Add servers to your license in the console to create more.'
        );
      }
      const reason =
        answer.reason === 'in_use_elsewhere'
          ? 'in_use_elsewhere'
          : answer.reason === 'replaced'
            ? 'replaced'
            : 'unpaid';
      throw new LicenseLimitError('license_expired', expiredMessage({ reason }));
    }
    if (answer.result === 'unreachable' && !(await licenseCheckin.checkedInRecently())) {
      throw new LicenseLimitError(
        'checkin_stale',
        "This install hasn't reached autotournament.gg for 3 days, so new servers can't be created with a paid license. Servers already set up keep working. Check the internet connection and try again."
      );
    }
  }

  async getStatus(): Promise<LicenseStatus> {
    const [key, serverCount] = await Promise.all([this.getKey(), countServers()]);
    const status = statusFor(key, {
      serverCount,
      version: packageJson.version,
      lineDate: buildLineDate(packageJson.version),
    });
    const standing = await this.standing();
    if (!key) return { ...status, standing };
    // Lazy: the check-in service reads the database, and tests import this file's pure half.
    const { licenseCheckin, readEventActivity } = await import('./checkinService');
    const [checkin, eventPrompt] = await Promise.all([
      licenseCheckin.status(true),
      status.status === 'invalid'
        ? null
        : licenseCheckin.eventPrompt(status.license, readEventActivity),
    ]);
    return { ...status, checkin, eventPrompt, standing };
  }

  /**
   * The admin's answer to the event-license question (or closing it). An
   * answer goes out with the next check-in, which is started now.
   */
  async answerEventPrompt(
    action: EventPromptAction,
    licenseId: string,
    actor: string
  ): Promise<void> {
    const { licenseCheckin } = await import('./checkinService');
    await licenseCheckin.answerEventPrompt(action, licenseId, actor);
    if (action !== 'dismissed' && action !== 'dont_ask') void licenseCheckin.run();
  }

  private async keyChanged(before: string | null): Promise<void> {
    const after = await this.getKey();
    if (after === before) return;
    (await import('../../middleware/licenseExpired')).licenseStandingChanged();
    const { licenseKeyChanged } = await import('./checkinService');
    licenseKeyChanged(after !== null);
  }

  /**
   * Store a key. Only something that isn't a license key at all is refused
   * (see `keyInputProblem`); a key with a bad signature or an unknown signing
   * key is stored and shown as invalid, so a key from a newer signing key
   * works once the platform is updated.
   */
  async setKey(input: string): Promise<LicenseStatus> {
    const before = await this.getKey();
    await settingsService.setSetting('license_key', input.trim());
    await this.keyChanged(before);
    return this.getStatus();
  }

  async clearKey(): Promise<LicenseStatus> {
    const before = await this.getKey();
    await settingsService.setSetting('license_key', null);
    await this.keyChanged(before);
    return this.getStatus();
  }

  /**
   * The line players see on public event pages, always: a genuine platform
   * key says licensed for commercial use (paid, not expired) or non-profit
   * use (a free key), with a link to its public check page; anything else
   * (no key, an invalid or expired one) says unlicensed. Warnings (an ended
   * window, more servers than the pack) stay admin-only.
   */
  async getPublicBadge(): Promise<{
    use: 'commercial' | 'non_commercial' | 'none';
    verifyUrl: string | null;
  }> {
    const none = { use: 'none' as const, verifyUrl: null };
    const key = await this.getKey();
    if (!key) return none;
    const check = verifyLicense(key, { product: 'platform' });
    if (
      !check.valid ||
      !check.license ||
      check.license.product !== 'platform' ||
      check.license.lease
    )
      return none;
    const verifyUrl = verifyUrlFor(check.license.id);
    if (check.license.kind === 'free') return { use: 'non_commercial', verifyUrl };
    if ((await this.standing()).status === 'expired') return none;
    return { use: 'commercial', verifyUrl };
  }
}

export const licenseService = new LicenseService();
