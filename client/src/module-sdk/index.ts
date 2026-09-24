/**
 * Module SDK: the platform code a client-side game module may import.
 *
 * A game module (`client/src/integrations/<id>/**`) is meant to be buildable
 * on its own and loaded at runtime (DESIGN-module-client-api.md, item 8, 8c).
 * For that it may depend only on a defined surface:
 *
 *   - this barrel, `client/src/module-sdk`
 *   - `client/src/integrations/types` (the slot contract)
 *   - the shared packages the host hands out as singletons: `react`,
 *     `react/jsx-runtime`, `react-dom`, `@mui/material`, `@mui/material/utils`,
 *     `@mui/material/styles`, `@emotion/react`, `@emotion/styled`,
 *     `react-router-dom`, `react-i18next`, `i18next`
 *   - stateless libraries the module bundles itself (`@mui/icons-material`, …)
 *
 * **A module imports platform code only from here.** Everything else in
 * `client/src` (hooks, utils, contexts, components, types, …) is core
 * internals that can change without notice, and would be missing from a
 * module built as its own bundle. `eslint-rules/module-sdk-boundary.mjs`
 * refuses every import that goes around this barrel (an error).
 *
 * This file will become a versioned public API (`clientApi`, 0.x in
 * lockstep with the platform until a module that is not ours depends on it).
 * Adding an export is a patch (`^0.1.0` still matches); removing, renaming or
 * narrowing one is a break. So it starts small on purpose: what CS2 and
 * manual-report use today and the design note lists, re-exported unchanged. Anything a module still
 * reaches past it is a finding to review, not something to add here by
 * reflex.
 */

// Links first: bundled modules read them while their integration object is
// built, so `./links` (which imports only `paths`) has to be evaluated before
// any import below could lead back into a module.
export { links } from './links';

import { useTranslation } from 'react-i18next';
import { useAuth as useAuthInternal } from '../contexts/AuthContext';

// Data access
export { api, apiErrorMessage } from '../utils/api';
export { onSocketReconnect } from '../utils/socketResync';
export { useSocket } from '../hooks/useSocket';

// Host contexts
export { useSnackbar } from '../contexts/SnackbarContext';
export { usePageHeader } from '../contexts/PageHeaderContext';

/**
 * What a module may know about the viewer: whether they are an admin, and who
 * they are. The platform's auth context carries more (login and logout flows,
 * impersonation, provider profile); a module gets none of it. Signing in,
 * Steam included, is the platform's.
 */
export type ModuleAuth = {
  /** An admin session is active. */
  isAuthenticated: boolean;
  /** The platform is still finding out who the viewer is. */
  isLoading: boolean;
  /** Someone is signed in as a player (admins who linked Steam included). */
  isPlayerAuthenticated: boolean;
  /**
   * The viewer's game-neutral account id (`players.uid`), or null when
   * nobody is signed in or the account has no players row yet. Follows
   * impersonation. This is how a module identifies a player: a module that
   * needs a game account id (CS2's Steam ID) maps the uid to it from its own
   * data (DESIGN-module-client-api.md, decision 5).
   */
  playerUid: string | null;
  /**
   * @deprecated Identify players by `playerUid`. Kept so 0.1.0 modules still
   * load; it goes in the next breaking version.
   */
  playerSteamId: string | null;
};

/** The host's auth context, narrowed to {@link ModuleAuth}. Same hook, same value. */
export const useAuth: () => ModuleAuth = useAuthInternal;

// Design tokens
export { tokens, mono, withAlpha } from '../theme/tokens';

// Match details: core's dialog, opened by slug (decision 7)
export { openMatchDetails } from '../components/modals/matchDetailsOpener';

// Components
export { default as ConfirmDialog } from '../components/modals/ConfirmDialog';
export { SegmentedControl } from '../components/tournament/setup/SegmentedControl';
export { EmptyState } from '../components/shared/EmptyState';
export { StatusDot } from '../components/common/ui';
export { PlayerAvatar } from '../components/player/PlayerAvatar';
export { ManageStatusTile } from '../components/manage/StatusStrip';

// Strings

/** Core's own i18next namespace, where strings every page shares live. */
export const CORE_NAMESPACE = 'translation';

/**
 * `useTranslation` for a module's own components: `t` reads the module's
 * namespace (its id, filled from `ClientGameIntegration.locales`) first, and
 * core's after it, so `t('serversPage.title')` is the module's string and
 * `t('common.cancel')` is still core's. Within each namespace a string the
 * viewer's language lacks is the module's English, before anything else.
 *
 * Pass the module's id. Pass the same `t` to `<Trans t={t}>`, which otherwise
 * reads core's namespace only.
 */
export function useModuleTranslation(moduleId: string) {
  return useTranslation(moduleNamespaces(moduleId), { nsMode: 'fallback' });
}

/** One array per module, so the namespaces a hook passes stay the same object across renders. */
const namespacesByModule = new Map<string, readonly [string, string]>();
function moduleNamespaces(moduleId: string): readonly [string, string] {
  let namespaces = namespacesByModule.get(moduleId);
  if (!namespaces) {
    namespaces = [moduleId, CORE_NAMESPACE];
    namespacesByModule.set(moduleId, namespaces);
  }
  return namespaces;
}

// Labels
export { getRoundLabel, getBracketMatchLabel } from '../utils/matchUtils';
export { CLIENT_API_VERSION } from './version';
