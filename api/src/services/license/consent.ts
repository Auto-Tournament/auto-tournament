/**
 * Accepting the license terms: a one-time step for the instance admin.
 *
 * Auto Tournament is source-available under the PolyForm Noncommercial
 * License 1.0.0. Before the admin UI opens, an admin says whether this
 * instance is used non-commercially (free) or commercially (needs a license)
 * and types "I AGREE". That record is kept in `app_settings`
 * (`license_consent`, JSON) with a short history (`license_consent_history`).
 *
 * **This only gates the admin UI** (the client redirects admin pages to the
 * consent page). The API, public pages, players and running matches are never
 * blocked by it, and a missing license key still blocks nothing
 * (./licenseService).
 *
 * A non-interactive install can accept up front with `AT_ACCEPT_LICENSE`
 * (`noncommercial` or `commercial`); the acceptance is then recorded as the
 * environment's, the first time anything asks for the status.
 *
 * `LICENSE_TERMS_VERSION` goes up only when the terms change in a way admins
 * must agree to again. Then every earlier acceptance is out of date and the
 * consent step shows again (or `AT_ACCEPT_LICENSE` accepts the new version).
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { log } from '../../utils/logger';
import { settingsService } from '../settingsService';
import { PRICING_URL, keyInputProblem, licenseService } from './licenseService';

/** Bump only when admins must accept the terms again. */
export const LICENSE_TERMS_VERSION = 1;
export const LICENSE_TERMS_NAME = 'PolyForm Noncommercial License 1.0.0';
export const LICENSE_TERMS_URL = 'https://polyformproject.org/licenses/noncommercial/1.0.0';
export const LICENSING_DOCS_URL = 'https://docs.autotournament.gg/reference/licensing';
export const COMMERCIAL_TERMS_URL = 'https://autotournament.gg/terms';
/** What the admin types to accept (any case). */
export const CONSENT_PHRASE = 'I AGREE';

export type LicenseUse = 'noncommercial' | 'commercial';

export interface LicenseConsentRecord {
  use: LicenseUse;
  /** ISO timestamp. */
  acceptedAt: string;
  /** The admin's Steam ID, or `env:AT_ACCEPT_LICENSE`. */
  acceptedBy: string;
  /** `admin` (typed I AGREE) or `env` (AT_ACCEPT_LICENSE). */
  source: 'admin' | 'env';
  termsVersion: number;
  /** `sha256:<hex>` of the LICENSE file this build ships, when it was found. */
  termsHash: string | null;
}

export interface LicenseTerms {
  name: string;
  version: number;
  hash: string | null;
  url: string;
  docsUrl: string;
  pricingUrl: string;
  commercialTermsUrl: string;
  phrase: string;
}

export interface LicenseConsentStatus {
  /** True when an acceptance of the current terms version is on record. */
  accepted: boolean;
  /**
   * Why the consent step shows: `none` (never accepted) or `version` (the
   * terms changed since). Null when accepted.
   */
  reason: 'none' | 'version' | null;
  /** The latest acceptance, current or not. */
  consent: LicenseConsentRecord | null;
  terms: LicenseTerms;
  /** Set when AT_ACCEPT_LICENSE is set (valid or not), so the UI can say so. */
  envAccept: LicenseUse | 'invalid' | null;
}

const HISTORY_LIMIT = 50;
export const ENV_ACTOR = 'env:AT_ACCEPT_LICENSE';

/** `noncommercial` / `commercial` (and a few spellings), else null. */
export function parseLicenseUse(value: unknown): LicenseUse | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['noncommercial', 'non-commercial', 'personal', 'free'].includes(v)) return 'noncommercial';
  if (v === 'commercial') return 'commercial';
  return null;
}

/** Does the typed confirmation say I AGREE (any case, outer spaces ignored)? */
export function isConsentPhrase(value: unknown): boolean {
  return typeof value === 'string' && value.trim().replace(/\s+/g, ' ').toUpperCase() === CONSENT_PHRASE;
}

/** AT_ACCEPT_LICENSE, read now: the use, `invalid`, or null when unset. */
export function envAcceptance(env: NodeJS.ProcessEnv = process.env): LicenseUse | 'invalid' | null {
  const raw = env.AT_ACCEPT_LICENSE?.trim();
  if (!raw) return null;
  return parseLicenseUse(raw) ?? 'invalid';
}

let cachedHash: string | null | undefined;

/** `sha256:<hex>` of the LICENSE file this build ships (image: /app/LICENSE), or null. */
export function licenseTextHash(): string | null {
  if (cachedHash !== undefined) return cachedHash;
  const candidates = [
    path.resolve(process.cwd(), 'LICENSE'),
    path.resolve(process.cwd(), '..', 'LICENSE'),
    path.resolve(__dirname, '..', '..', '..', '..', 'LICENSE'),
    path.resolve(__dirname, '..', '..', '..', 'LICENSE'),
  ];
  cachedHash = null;
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('PolyForm Noncommercial')) continue;
      // Line endings must not change the hash (a Windows checkout).
      cachedHash = `sha256:${createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')}`;
      break;
    } catch {
      // Not here; try the next place.
    }
  }
  return cachedHash;
}

export function currentTerms(): LicenseTerms {
  return {
    name: LICENSE_TERMS_NAME,
    version: LICENSE_TERMS_VERSION,
    hash: licenseTextHash(),
    url: LICENSE_TERMS_URL,
    docsUrl: LICENSING_DOCS_URL,
    pricingUrl: PRICING_URL,
    commercialTermsUrl: COMMERCIAL_TERMS_URL,
    phrase: CONSENT_PHRASE,
  };
}

/** A stored record, or null when it is missing or unreadable. */
export function parseConsentRecord(raw: string | null | undefined): LicenseConsentRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LicenseConsentRecord>;
    const use = parseLicenseUse(value.use);
    if (!use || typeof value.acceptedAt !== 'string' || typeof value.termsVersion !== 'number') {
      return null;
    }
    return {
      use,
      acceptedAt: value.acceptedAt,
      acceptedBy: typeof value.acceptedBy === 'string' ? value.acceptedBy : 'unknown',
      source: value.source === 'env' ? 'env' : 'admin',
      termsVersion: value.termsVersion,
      termsHash: typeof value.termsHash === 'string' ? value.termsHash : null,
    };
  } catch {
    return null;
  }
}

/** The status for a stored record. Pure. */
export function consentStatusFor(
  record: LicenseConsentRecord | null,
  terms: LicenseTerms,
  envAccept: LicenseUse | 'invalid' | null
): LicenseConsentStatus {
  const current = !!record && record.termsVersion >= terms.version;
  return {
    accepted: current,
    reason: current ? null : record ? 'version' : 'none',
    consent: record,
    terms,
    envAccept,
  };
}

class LicenseConsentService {
  /**
   * Test-only (routes/test.ts): ignore AT_ACCEPT_LICENSE, so the E2E suite,
   * whose server pre-accepts, can see the consent step.
   */
  private envSuspended = false;

  setEnvSuspendedForTest(suspended: boolean): void {
    this.envSuspended = suspended;
  }

  private envAccept(): LicenseUse | 'invalid' | null {
    return this.envSuspended ? null : envAcceptance();
  }

  async getRecord(): Promise<LicenseConsentRecord | null> {
    return parseConsentRecord(await settingsService.getSetting('license_consent'));
  }

  async getHistory(): Promise<LicenseConsentRecord[]> {
    const raw = await settingsService.getSetting('license_consent_history');
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as unknown[];
      if (!Array.isArray(list)) return [];
      return list
        .map((entry) => parseConsentRecord(JSON.stringify(entry)))
        .filter((entry): entry is LicenseConsentRecord => entry !== null);
    } catch {
      return [];
    }
  }

  /**
   * The status. When the current terms are not accepted and AT_ACCEPT_LICENSE
   * is set, the environment's acceptance is recorded first.
   */
  async getStatus(): Promise<LicenseConsentStatus> {
    const terms = currentTerms();
    const envAccept = this.envAccept();
    let record = await this.getRecord();
    const due = !record || record.termsVersion < terms.version;
    if (due && envAccept && envAccept !== 'invalid') {
      record = await this.record(envAccept, ENV_ACTOR, 'env');
    }
    return consentStatusFor(record, terms, envAccept);
  }

  /** Record an acceptance of the current terms, and keep it in the history. */
  async record(use: LicenseUse, actor: string, source: 'admin' | 'env'): Promise<LicenseConsentRecord> {
    const terms = currentTerms();
    const record: LicenseConsentRecord = {
      use,
      acceptedAt: new Date().toISOString(),
      acceptedBy: actor,
      source,
      termsVersion: terms.version,
      termsHash: terms.hash,
    };
    const history = [record, ...(await this.getHistory())].slice(0, HISTORY_LIMIT);
    await settingsService.setSetting('license_consent', JSON.stringify(record));
    await settingsService.setSetting('license_consent_history', JSON.stringify(history));
    log.info(
      `[LICENSE] License terms v${terms.version} accepted for ${use} use by ${actor}` +
        (source === 'env' ? ' (AT_ACCEPT_LICENSE)' : '')
    );
    return record;
  }

  /** Test-only: forget the acceptance (the history stays). */
  async clearForTest(): Promise<void> {
    await settingsService.setSetting('license_consent', null);
  }

  /** Test-only: store a record as-is (an older terms version, say). */
  async setRecordForTest(record: LicenseConsentRecord): Promise<void> {
    await settingsService.setSetting('license_consent', JSON.stringify(record));
  }
}

export const licenseConsentService = new LicenseConsentService();

/**
 * At startup: record AT_ACCEPT_LICENSE's acceptance, and save LICENSE_KEY
 * when it differs from the stored key. Logged; never throws, never blocks
 * the boot. The key itself is never logged.
 */
export async function applyLicenseEnvironment(): Promise<void> {
  const envAccept = envAcceptance();
  if (envAccept === 'invalid') {
    log.warn('[LICENSE] AT_ACCEPT_LICENSE must be "noncommercial" or "commercial"; ignored');
  }
  try {
    await licenseConsentService.getStatus();
  } catch (error) {
    log.warn('[LICENSE] Could not read the license consent', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const envKey = process.env.LICENSE_KEY?.trim();
  if (!envKey) return;
  try {
    const problem = keyInputProblem(envKey);
    if (problem) {
      log.warn(`[LICENSE] LICENSE_KEY is not a license key (${problem}); ignored`);
      return;
    }
    if ((await licenseService.getKey()) === envKey) return;
    const status = await licenseService.setKey(envKey);
    log.info(`[LICENSE] License key from LICENSE_KEY saved (status: ${status.status})`);
  } catch (error) {
    log.warn('[LICENSE] Could not save LICENSE_KEY', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
