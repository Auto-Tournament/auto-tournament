/**
 * The instance's Auto Tournament license key: stored, checked offline
 * (./verify), and described for the admin UI.
 *
 * **Nothing here ever blocks, disables or degrades anything.** Free
 * non-commercial use is legitimate: no key is a quiet note for admins, and a
 * problem with a key is a warning for admins. Nothing is shown to players
 * unless an admin turns the public badge on, and then only for a valid key.
 *
 * The key is stored in `app_settings` (`license_key`), set only through
 * /api/license. It is not a secret, but it is treated as sensitive: never
 * logged, never returned after saving (the admin sees the license id). The
 * one reader outside this service is the game hosts' update-hold poll
 * (integrations/cs2/services/updateHoldService.ts), which hands it to CS2
 * Server Manager for Ready Up, behind the server token.
 */

import { settingsService } from '../settingsService';
import { isTruthySetting } from '../../utils/settingFields';
import packageJson from '../../../package.json';
import { buildLineDate } from './lineDate';
import { countServers } from './serverCount';
import type { CheckinStatus, EventPromptAction, EventPromptStatus } from './checkin';
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
  /** The admin toggle for the public "Licensed" line. */
  publicBadge: boolean;
  /**
   * The daily check-in (./checkin.ts): when it last went through, the
   * server's notice (a calm note, never a block) and what is sent. Null
   * without a key: then nothing is sent at all.
   */
  checkin: CheckinStatus | null;
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
  publicBadge: boolean;
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
    publicBadge: inputs.publicBadge,
    checkin: null,
    eventPrompt: null,
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
  try {
    decodeLicense(input);
  } catch {
    return 'This is not an Auto Tournament license key (it starts with ATL1.)';
  }
  return null;
}

class LicenseService {
  async getKey(): Promise<string | null> {
    return (await settingsService.getSetting('license_key'))?.trim() || null;
  }

  async isPublicBadgeEnabled(): Promise<boolean> {
    const value = await settingsService.getSetting('license_public_badge');
    return value ? isTruthySetting(value) : false;
  }

  async getStatus(): Promise<LicenseStatus> {
    const [key, serverCount, publicBadge] = await Promise.all([
      this.getKey(),
      countServers(),
      this.isPublicBadgeEnabled(),
    ]);
    const status = statusFor(key, {
      serverCount,
      publicBadge,
      version: packageJson.version,
      lineDate: buildLineDate(packageJson.version),
    });
    if (!key) return status;
    // Lazy: the check-in service reads the database, and tests import this file's pure half.
    const { licenseCheckin, readEventActivity } = await import('./checkinService');
    const [checkin, eventPrompt] = await Promise.all([
      licenseCheckin.status(true),
      status.status === 'invalid' ? null : licenseCheckin.eventPrompt(status.license, readEventActivity),
    ]);
    return { ...status, checkin, eventPrompt };
  }

  /**
   * The admin's answer to the event-license question (or closing it). An
   * answer goes out with the next check-in, which is started now.
   */
  async answerEventPrompt(action: EventPromptAction, licenseId: string, actor: string): Promise<void> {
    const { licenseCheckin } = await import('./checkinService');
    await licenseCheckin.answerEventPrompt(action, licenseId, actor);
    if (action !== 'dismissed' && action !== 'dont_ask') void licenseCheckin.run();
  }

  private async keyChanged(before: string | null): Promise<void> {
    const after = await this.getKey();
    if (after === before) return;
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

  async setPublicBadge(enabled: boolean): Promise<LicenseStatus> {
    await settingsService.setSetting('license_public_badge', enabled ? '1' : '0');
    return this.getStatus();
  }

  /**
   * The public "Licensed" line: only when the admin turned it on and the
   * saved key is a genuine platform key. Warnings (an ended window, more
   * servers than the pack) stay admin-only, so they don't hide it.
   */
  async getPublicBadge(): Promise<{ verifyUrl: string } | null> {
    if (!(await this.isPublicBadgeEnabled())) return null;
    const key = await this.getKey();
    if (!key) return null;
    const check = verifyLicense(key, { product: 'platform' });
    if (!check.valid || !check.license || check.license.product !== 'platform') return null;
    return { verifyUrl: verifyUrlFor(check.license.id) };
  }
}

export const licenseService = new LicenseService();
