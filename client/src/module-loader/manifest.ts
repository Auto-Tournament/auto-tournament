/**
 * What `GET /api/modules` answers, which of those modules the browser loads,
 * and the ways loading one can fail (DESIGN-module-client-api.md §4).
 *
 * Pure: no React, no semver, no fetch. The boot path in the main bundle and
 * the Modules page read it, and a spec checks it in Node.
 */

/** One module, as the server lists it. */
export interface ModuleListEntry {
  id: string;
  name: string;
  version: string;
  /** `builtin` ships compiled into this bundle; `disk` is a code module an operator installed. */
  source: 'builtin' | 'disk';
  /** The semver range of client APIs the module declares it works with. */
  clientApi: string | null;
  serverApi: string | null;
  enabled: boolean;
  status: ModuleServerStatus;
  reason: string | null;
  /** Where its client code is served, e.g. `/api/modules/<id>/client/index.js`. */
  client: { entry: string } | null;
}

export type ModuleServerStatus = 'ok' | 'incompatible' | 'broken' | 'disabled';

export interface ModuleListing {
  platform: { clientApi: string; serverApi: string };
  modules: ModuleListEntry[];
}

/** A code module the browser should load: enabled, on disk, fine by the server, with client code. */
export type LoadableModule = ModuleListEntry & { client: { entry: string } };

/**
 * The modules the loader imports. Built-ins are compiled in and never loaded
 * by URL; a module the server already refused, or one that is disabled, is
 * shown on the Modules page and not fetched.
 */
export function modulesToLoad(modules: readonly ModuleListEntry[]): LoadableModule[] {
  return modules.filter(
    (entry): entry is LoadableModule =>
      entry.source === 'disk' &&
      entry.enabled &&
      entry.status === 'ok' &&
      entry.client !== null &&
      typeof entry.client?.entry === 'string'
  );
}

/** Loose shape check of the response, so a proxy's HTML or an old API is "no modules", not a crash. */
export function parseModuleListing(body: unknown): ModuleListing | null {
  if (!body || typeof body !== 'object') return null;
  const { platform, modules } = body as { platform?: unknown; modules?: unknown };
  if (!Array.isArray(modules)) return null;
  const valid = modules.filter(
    (entry): entry is ModuleListEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as ModuleListEntry).id === 'string' &&
      typeof (entry as ModuleListEntry).source === 'string'
  );
  const p = (platform ?? {}) as Partial<ModuleListing['platform']>;
  return {
    platform: {
      clientApi: typeof p.clientApi === 'string' ? p.clientApi : '',
      serverApi: typeof p.serverApi === 'string' ? p.serverApi : '',
    },
    modules: valid,
  };
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * Where it failed:
 * - `contract`: refused before any code was fetched (entry URL, clientApi range),
 *   or the code's default export is not a module
 * - `import`: fetching, parsing, linking or evaluating the code
 * - `render`: a slot threw while rendering, this session
 */
export type ModuleFailureStage = 'contract' | 'import' | 'render';

export type ModuleFailureCode =
  | 'badEntry'
  | 'noClientApi'
  | 'badClientApi'
  | 'outOfRange'
  | 'notFound'
  | 'httpError'
  | 'notJavaScript'
  | 'importFailed'
  | 'timeout'
  | 'sharedFailed'
  | 'badExport'
  | 'idMismatch'
  | 'idTaken'
  | 'render';

/**
 * Why a module is broken. `code` + `params` is what the Modules page
 * translates (`modulesPage.code.failure.<code>`); `message` is the same thing
 * in English, for the console and for anything that cannot translate.
 */
export interface ModuleFailure {
  stage: ModuleFailureStage;
  code: ModuleFailureCode;
  params: Record<string, string | number>;
  message: string;
}

export function failure(
  stage: ModuleFailureStage,
  code: ModuleFailureCode,
  message: string,
  params: Record<string, string | number> = {}
): ModuleFailure {
  return { stage, code, params, message };
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  return String(error);
}

/**
 * Module code is only ever loaded from the module's own static route under
 * `/api/modules/<id>/`. That route answers a real 404; a path the SPA falls
 * back on answers 200 with index.html, which fails as a MIME error that says
 * nothing useful (the spike's `missing` fixture). Same origin, no scheme, no
 * `..`, no query tricks.
 */
export function entryProblem(id: string, entry: string): ModuleFailure | null {
  const prefix = `/api/modules/${encodeURIComponent(id)}/`;
  const ok =
    entry.startsWith(prefix) &&
    entry.length > prefix.length &&
    !entry.includes('//') &&
    !entry.includes('\\') &&
    !entry.split(/[?#]/)[0].split('/').some((segment) => segment === '..' || segment === '.');
  if (ok) return null;
  return failure('contract', 'badEntry', `its code is not served from ${prefix} (got ${entry})`, {
    entry,
    prefix,
  });
}

// ---------------------------------------------------------------------------
// The slots a code module can fill
// ---------------------------------------------------------------------------

/**
 * Every component slot of `ClientGameIntegration`, as a path. The validator
 * checks each one a module fills is a component, and the adapter puts an
 * error boundary around each, so a slot that throws is "this module is
 * broken" and not a white page. `integration-slots` in the spec keeps this
 * list in step with `integrations/types.ts`.
 */
export const COMPONENT_SLOTS = [
  'matchPanels.teamView',
  'matchPanels.adminView',
  'matchPanels.reportView',
  'teamAdminPanel',
  'adminGlobalWarning',
  'tournamentStart.confirmView',
  'tournamentStart.failureView',
  'tournamentStart.preflight.view',
  'matchQueueBanner',
  'matchQueueChip',
  'matchListQueue.banner',
  'matchListQueue.countdown',
  'matchListQueue.cardStatus',
  'manageStatusTile',
  'adminDisputesView',
  'tournamentStatsView',
  'preMatchView',
  'preMatchHistory',
  'tournamentSetupSteps.rules',
  'tournamentSetupSteps.content',
  'tournamentSetupSteps.settings',
  'standaloneMatchSteps.rules',
  'standaloneMatchSteps.content',
  'resourceDialogs.add',
  'resourceDialogs.batchAdd',
  'dashboardWidgets.adminHomeResources',
  'dashboardWidgets.manageResources',
] as const;

export type ComponentSlot = (typeof COMPONENT_SLOTS)[number];

/** Slot groups every integration carries, even when it fills none of them. */
export const REQUIRED_GROUPS = [
  'matchPanels',
  'tournamentSetupSteps',
  'standaloneMatchSteps',
  'resourceDialogs',
  'dashboardWidgets',
] as const;

export const CAPABILITY_KEYS = ['servers', 'veto', 'liveEvents', 'demos', 'playerStats'] as const;

export function getPath(root: unknown, path: string): unknown {
  let value: unknown = root;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
