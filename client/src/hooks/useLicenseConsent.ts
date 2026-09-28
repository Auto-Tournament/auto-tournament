import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../utils/api';

/**
 * The license terms acceptance (`GET /api/license/consent`,
 * api/src/services/license/consent.ts). One shared copy per page load: the
 * admin shell's gate, the consent page and Settings → License read the same
 * status, so accepting on one updates the others.
 */

export type LicenseUse = 'noncommercial' | 'commercial';

export interface LicenseConsentRecord {
  use: LicenseUse;
  acceptedAt: string;
  /** The admin's Steam ID, or `env:AT_ACCEPT_LICENSE`. */
  acceptedBy: string;
  source: 'admin' | 'env';
  termsVersion: number;
  termsHash: string | null;
}

export interface LicenseConsentStatus {
  accepted: boolean;
  reason: 'none' | 'version' | null;
  consent: LicenseConsentRecord | null;
  terms: {
    name: string;
    version: number;
    hash: string | null;
    url: string;
    docsUrl: string;
    pricingUrl: string;
    commercialTermsUrl: string;
    phrase: string;
  };
  envAccept: LicenseUse | 'invalid' | null;
  history: LicenseConsentRecord[];
}

export interface LicenseConsentResponse {
  success: boolean;
  consent: LicenseConsentStatus;
}

interface State {
  status: LicenseConsentStatus | null;
  /** True once a load finished, whether or not it worked. */
  loaded: boolean;
}

let state: State = { status: null, loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fetch the status (once, unless `force`). A failure leaves `status` null. */
export function loadLicenseConsent(force = false): Promise<void> {
  if (inflight) return inflight;
  if (state.loaded && !force) return Promise.resolve();
  inflight = api
    .get<LicenseConsentResponse>('/api/license/consent')
    .then((res) => emit({ status: res.consent, loaded: true }))
    .catch(() => emit({ status: null, loaded: true }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** After an accept: every reader sees the new status. */
export function setLicenseConsent(status: LicenseConsentStatus) {
  emit({ status, loaded: true });
}

/** Accept the terms. Throws the API's error. */
export async function acceptLicenseTerms(input: {
  use: LicenseUse;
  confirm: string;
  key?: string;
  termsVersion?: number;
}): Promise<LicenseConsentStatus> {
  const res = await api.post<LicenseConsentResponse>('/api/license/consent', input);
  setLicenseConsent(res.consent);
  return res.consent;
}

/** Admin only. Loads on first use; `enabled: false` reads without loading. */
export function useLicenseConsent(enabled = true) {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (enabled && !snapshot.loaded) void loadLicenseConsent();
  }, [enabled, snapshot.loaded]);
  return snapshot;
}

/** Does the typed text say I AGREE (any case)? Same rule as the API. */
export function isConsentPhrase(value: string): boolean {
  return value.trim().replace(/\s+/g, ' ').toUpperCase() === 'I AGREE';
}
