import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { api } from '../utils/api';

/** `GET /api/license`'s `license` (api/src/services/license/licenseService.ts). Never the key. */
export interface LicenseStatus {
  status: 'none' | 'ok' | 'warning' | 'invalid';
  license: {
    id: string;
    licensee: string | null;
    product: 'platform' | 'servers';
    pack: 'S' | 'M' | 'L';
    maxServers: number;
    kind: 'month' | 'year' | 'founder' | 'event' | 'free';
    issuedAt: string;
    /** Null: a founder license, updates for life. */
    updatesUntil: string | null;
    validFrom: string | null;
    validTo: string | null;
  } | null;
  warnings: Array<{ code: string; message: string }>;
  verifyUrl: string | null;
  pricingUrl: string;
  serverCount: number | null;
  version: string;
  lineDate: string;
  publicBadge: boolean;
  /** The daily check-in; null without a key (then nothing is sent). */
  checkin: {
    lastAt: string | null;
    /** Plain text from autotournament.gg, shown as a calm note. */
    notice: string | null;
    sent: string[];
    privacyUrl: string;
  } | null;
  /** Where the paid license stands (api/src/services/license/gate.ts): past_due warns admins, expired stops the platform. */
  standing?: {
    status: 'free' | 'invalid' | 'active' | 'past_due' | 'expired';
    paid: boolean;
    maxServers: number | null;
    licenseId: string | null;
    stopsOn: string | null;
    /** Why it is past due or expired: unpaid, the key was replaced in the console, or the key belongs to another install. */
    reason?: 'unpaid' | 'replaced' | 'in_use_elsewhere' | null;
  };
  /** An event license only: the quiet "what's this?" question on the admin home. */
  eventPrompt: {
    shouldAsk: boolean;
    validFrom: string;
    validTo: string;
    declared: EventDeclared;
    declaredAt: string | null;
  } | null;
}

export type EventDeclared = 'none' | 'testing' | 'new_event' | 'dates_moved';
export type EventPromptAction = Exclude<EventDeclared, 'none'> | 'dismissed' | 'dont_ask';

/** The label key of an answer to the event-license question. */
export const EVENT_ANSWER_LABEL: Record<Exclude<EventDeclared, 'none'>, string> = {
  testing: 'license.eventPrompt.testing',
  new_event: 'license.eventPrompt.newEvent',
  dates_moved: 'license.eventPrompt.datesMoved',
};

/** "2026-10-03 to 2026-10-05", or the one day. */
export function eventDates(from: string, to: string, t: TFunction): string {
  return from === to ? from : t('license.eventPrompt.datesRange', { from, to });
}

/**
 * A warning in the admin's language where the UI knows it (the event dates),
 * else the API's English text.
 */
export function licenseWarningText(
  warning: { code: string; message: string },
  license: LicenseStatus['license'],
  t: TFunction
): string {
  if (warning.code === 'period_ended' && license?.validTo) {
    return t('license.warning.periodEnded', { date: license.validTo });
  }
  if (warning.code === 'period_not_started' && license?.validFrom) {
    return t('license.warning.periodNotStarted', { date: license.validFrom });
  }
  return warning.message;
}

export interface LicenseStatusResponse {
  success: boolean;
  license: LicenseStatus;
}

/** Admin only: the saved license key's status. `status` is null until loaded, or when it could not be. */
export function useLicenseStatus(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<LicenseStatusResponse>('/api/license');
      setStatus(res.license);
    } catch {
      setStatus(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [reload, enabled]);

  return { status, setStatus, loaded, reload };
}

/** "Licensed to NTLAN · Platform S · 6 servers · updates until 2027-09-01". */
export function licenseSummary(license: NonNullable<LicenseStatus['license']>, t: TFunction): string {
  if (license.kind === 'free') {
    return [license.licensee ? t('license.summary.freeFor', { licensee: license.licensee }) : t('license.summary.free'), t('license.summary.noLimit')].join(' · ');
  }
  return [
    license.licensee
      ? t('license.summary.licensedTo', { licensee: license.licensee })
      : t('license.summary.licensed'),
    t(`license.summary.product.${license.product}`, { pack: license.pack }),
    t('license.summary.servers', { count: license.maxServers }),
    license.kind === 'event' && license.validFrom && license.validTo
      ? t('license.summary.eventWindow', { from: license.validFrom, to: license.validTo })
      : license.updatesUntil
        ? t('license.summary.updatesUntil', { date: license.updatesUntil })
        : t('license.summary.updatesForLife'),
  ].join(' · ');
}
