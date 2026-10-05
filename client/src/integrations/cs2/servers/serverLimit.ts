/**
 * How many servers the instance may run, for the Servers page: unlimited for
 * non-commercial use, else what the saved license covers. Every server
 * counts, practice and test servers included (api/src/services/license).
 */
import { useEffect, useState } from 'react';
import { api } from '../../../module-sdk';

export type ServerLimit =
  | { kind: 'unlimited' }
  | { kind: 'licensed'; max: number }
  /** Commercial use accepted, but no license key saved yet. */
  | { kind: 'unlicensed' };

interface LicenseResponse {
  license?: { maxServers?: number } | null;
}
interface ConsentResponse {
  consent?: { consent?: { use?: string } | null } | null;
}

export function useServerLimit(): ServerLimit | null {
  const [limit, setLimit] = useState<ServerLimit | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.get<LicenseResponse>('/api/license').catch(() => null),
      api.get<ConsentResponse>('/api/license/consent').catch(() => null),
    ]).then(([license, consent]) => {
      if (cancelled) return;
      const max = license?.license?.maxServers;
      if (typeof max === 'number') setLimit({ kind: 'licensed', max });
      else if (consent?.consent?.consent?.use === 'commercial') setLimit({ kind: 'unlicensed' });
      else if (license) setLimit({ kind: 'unlimited' });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return limit;
}

/** The i18n key and values for the limit line, given the servers set up now. */
export function serverLimitText(limit: ServerLimit, used: number): { key: string; values: Record<string, number> } {
  if (limit.kind === 'unlimited') return { key: 'serversPage.limit.unlimited', values: {} };
  if (limit.kind === 'unlicensed') return { key: 'serversPage.limit.unlicensed', values: {} };
  const left = limit.max - used;
  if (left > 0) return { key: 'serversPage.limit.left', values: { max: limit.max, left } };
  if (left === 0) return { key: 'serversPage.limit.full', values: { max: limit.max } };
  return { key: 'serversPage.limit.over', values: { max: limit.max, over: -left } };
}
