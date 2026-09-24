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
 * reports every import that goes around this barrel (warn for now; the
 * count is the baseline to drive down).
 *
 * This file will become a versioned public API (`clientApi`, 0.x in
 * lockstep with the platform until a module that is not ours depends on it).
 * Adding an export is a minor; removing, renaming or narrowing one is a
 * major. So it starts small on purpose: what CS2 and manual-report use today
 * and the design note lists, re-exported unchanged. Anything a module still
 * reaches past it is a finding to review, not something to add here by
 * reflex.
 */

import { useAuth as useAuthInternal } from '../contexts/AuthContext';

// Data access
export { api, apiErrorMessage } from '../utils/api';
export { onSocketReconnect } from '../utils/socketResync';

// Host contexts
export { useSnackbar } from '../contexts/SnackbarContext';
export { usePageHeader } from '../contexts/PageHeaderContext';

/**
 * What a module may know about the viewer: whether they are an admin, and who
 * they are. The platform's auth context carries more (login and logout flows,
 * impersonation, provider profile); a module gets none of it.
 */
export type ModuleAuth = Pick<
  ReturnType<typeof useAuthInternal>,
  'isAuthenticated' | 'isLoading' | 'isPlayerAuthenticated' | 'playerSteamId'
>;

/** The host's auth context, narrowed to {@link ModuleAuth}. Same hook, same value. */
export const useAuth: () => ModuleAuth = useAuthInternal;

// Design tokens
export { tokens, mono, withAlpha } from '../theme/tokens';

// Components
export { default as ConfirmDialog } from '../components/modals/ConfirmDialog';
export { EmptyState } from '../components/shared/EmptyState';
export { StatusDot } from '../components/common/ui';
export { PlayerAvatar } from '../components/player/PlayerAvatar';
export { ManageStatusTile } from '../components/manage/StatusStrip';

// Labels
export { getRoundLabel, getBracketMatchLabel } from '../utils/matchUtils';
