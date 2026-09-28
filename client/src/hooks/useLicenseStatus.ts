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
    kind: 'event' | 'year' | 'founder';
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
}

export interface LicenseStatusResponse {
  success: boolean;
  license: LicenseStatus;
}

/** Admin only: the saved license key's status. `status` is null until loaded, or when it could not be. */
export function useLicenseStatus() {
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
    void reload();
  }, [reload]);

  return { status, setStatus, loaded, reload };
}

/** "Licensed to NTLAN · Platform S · 6 servers · updates until 2027-09-01". */
export function licenseSummary(license: NonNullable<LicenseStatus['license']>, t: TFunction): string {
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
