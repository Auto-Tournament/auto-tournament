/**
 * Boot: ask the server which code modules there are, and load them before
 * the routes render (DESIGN-module-client-api.md §4.2).
 *
 * The registry stays synchronous, because 51 call sites read it during
 * render. So loading happens once, up front, and the app renders when it is
 * done — never later than the timeouts below allow, whatever a module does.
 *
 * On an instance with no code module this costs one small request and loads
 * nothing else: the loader, the range check and the shared-package registry are a
 * separate chunk, imported only when there is something to load.
 */

import { modulesToLoad, parseModuleListing, type ModuleListing } from './manifest';
import { setBootStatus, setSafeMode } from './moduleState';

export const MODULES_ENDPOINT = '/api/modules';

/** How long the list may take before booting goes on without code modules. */
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

export type ModuleListResult =
  | { ok: true; listing: ModuleListing }
  | { ok: false; status: number | null; error: string };

/**
 * `GET /api/modules`. Never throws: a 401 (not an admin), a 404 (an API
 * without the endpoint), a timeout or an unexpected body is `ok: false`.
 */
export async function fetchModuleList(timeoutMs = LIST_TIMEOUT_MS): Promise<ModuleListResult> {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(MODULES_ENDPOINT, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    const listing = parseModuleListing(await response.json());
    return listing
      ? { ok: true, listing }
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
    const result = await fetchModuleList();
    if (!result.ok) return;
    const modules = modulesToLoad(result.listing.modules);
    if (modules.length === 0) return;

    const { loadAndRegister } = await import('./runtime');
    await loadAndRegister(modules);
  } catch (error) {
    // The loader turns every module's failure into a reason of its own; this
    // is the loader chunk itself failing to load. The app renders without
    // code modules rather than not at all.
    console.error('[modules] loading code modules failed', error);
  }
}

