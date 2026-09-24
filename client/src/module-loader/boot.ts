/**
 * Boot: ask the server which code modules to load, and load them before the
 * routes render (DESIGN-module-client-api.md §4.2).
 *
 * The registry stays synchronous, because many call sites read it during
 * render. Loading happens once, as early as possible (`main.tsx` starts it
 * before the first render), and settles within the timeouts below whatever a
 * module does.
 *
 * Every visitor boots from the public manifest, `GET /api/modules/public`:
 * players and signed-out visitors render module slots too (the team match
 * page, profiles, public tournament pages). The admin-only `GET /api/modules`
 * is for the Modules page, where the reasons and disabled modules belong.
 *
 * Nothing waits for it. The app renders at once; only a module-owned slot or
 * route whose module has not arrived yet shows a pending state
 * (`useIntegration` in `integrations/registry`), and re-renders when it does
 * (`moduleState`). On an instance with no code module this costs one small,
 * cacheable request and loads nothing else: the loader, the range check and
 * the shared-package registry are a separate chunk, imported only when there
 * is something to load, and no pending state is ever drawn.
 */

import {
  parseModuleListing,
  parsePublicManifest,
  type LoadableModule,
  type ModuleListing,
} from './manifest';
import { setBootStatus, setManifestStatus, setSafeMode } from './moduleState';

/** The admin list: every module with its status and reason. The Modules page. */
export const MODULES_ENDPOINT = '/api/modules';

/** The public manifest: the modules any browser loads at boot. */
export const PUBLIC_MANIFEST_ENDPOINT = '/api/modules/public';

/** How long a list may take before booting goes on without code modules. */
export const LIST_TIMEOUT_MS = 5_000;

/**
 * The most boot may ever hold the app back, whatever hangs: the list, the
 * loader chunk, the shared packages or a module (each import has its own
 * 10-second limit inside this).
 */
export const BOOT_DEADLINE_MS = 20_000;

/** `?modules=off` loads no code module, so a module that breaks the page can still be disabled. */
export function isSafeMode(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('modules') === 'off';
}

type Fetched<T> = { ok: true; value: T } | { ok: false; status: number | null; error: string };

/** GET a JSON endpoint and parse it. Never throws. */
async function fetchParsed<T>(
  url: string,
  parse: (body: unknown) => T | null,
  timeoutMs: number
): Promise<Fetched<T>> {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    const value = parse(await response.json());
    return value !== null
      ? { ok: true, value }
      : { ok: false, status: response.status, error: 'unexpected response' };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: controller.signal.aborted ? 'timed out' : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type ModuleListResult =
  | { ok: true; listing: ModuleListing }
  | { ok: false; status: number | null; error: string };

/**
 * `GET /api/modules`, admin-only, for the Modules page. Never throws: a 401
 * (not an admin), a 404 (an API without the endpoint), a timeout or an
 * unexpected body is `ok: false`.
 */
export async function fetchModuleList(timeoutMs = LIST_TIMEOUT_MS): Promise<ModuleListResult> {
  const result = await fetchParsed(MODULES_ENDPOINT, parseModuleListing, timeoutMs);
  return result.ok ? { ok: true, listing: result.value } : result;
}

export type PublicManifestResult =
  | { ok: true; modules: LoadableModule[] }
  | { ok: false; status: number | null; error: string };

/**
 * `GET /api/modules/public`, for anyone. Never throws: a 404 (an API from
 * before the public manifest), a timeout or an unexpected body is `ok: false`,
 * which boot reads as "no code modules".
 */
export async function fetchPublicManifest(
  timeoutMs = LIST_TIMEOUT_MS
): Promise<PublicManifestResult> {
  const result = await fetchParsed(PUBLIC_MANIFEST_ENDPOINT, parsePublicManifest, timeoutMs);
  return result.ok ? { ok: true, modules: result.value } : result;
}

let booting: Promise<void> | null = null;

/** Loads every code module the server lists, once per page load. Never rejects. */
export function bootCodeModules(): Promise<void> {
  if (!booting) {
    setBootStatus('running');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error(`[modules] code modules still loading after ${BOOT_DEADLINE_MS} ms; going on without them`);
        resolve();
      }, BOOT_DEADLINE_MS);
    });
    booting = Promise.race([run(), deadline]).finally(() => {
      clearTimeout(timer);
      setBootStatus('done');
    });
  }
  return booting;
}

async function run(): Promise<void> {
  try {
    if (isSafeMode()) {
      setSafeMode();
      return;
    }
    const result = await fetchPublicManifest();
    if (!result.ok || result.modules.length === 0) {
      // Nothing will arrive: every slot and route answers at once.
      setManifestStatus('empty');
      return;
    }
    setManifestStatus('listed');

    // The loader chunk still checks each entry's URL and clientApi range
    // itself: the manifest says what to load, not that it may be loaded.
    const { loadAndRegister } = await import('./runtime');
    await loadAndRegister(result.modules);
  } catch (error) {
    // The loader turns every module's failure into a reason of its own; this
    // is the loader chunk itself failing to load. The app renders without
    // code modules rather than not at all.
    console.error('[modules] loading code modules failed', error);
  }
}

