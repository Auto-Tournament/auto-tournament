/**
 * The admin home's "Finish setting up" rules for sign-in. Pure, so the tests
 * can import it.
 */

/** Settings -> Sign-in (the Settings page opens that tab from `?section=signin`). */
export const SIGN_IN_SETTINGS_PATH = '/manage/settings?section=signin';

export interface ProviderSummary {
  id: string;
  /** `/api/auth/providers` sets it only for a provider that is enabled and has its credentials. */
  enabled: boolean;
}

/** Sign-in is set up once any provider is offered on the login page. */
export function isSignInSetUp(providers: ReadonlyArray<ProviderSummary>): boolean {
  return providers.some((p) => p.enabled);
}

/** Where "Open settings" goes: the first unfinished item's own page, else Settings. */
export function setupCardTarget(items: ReadonlyArray<{ done: boolean; to?: string }>): string {
  return items.find((item) => !item.done && item.to)?.to ?? '/manage/settings';
}
