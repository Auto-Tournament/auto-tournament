/**
 * Loads the code modules the server listed: check, import, validate
 * (DESIGN-module-client-api.md §4.2 and §4.4).
 *
 * Every way a module can fail here ends as a `ModuleFailure` for that module
 * and nothing else. One module's 404, link error, top-level throw or hang
 * never stops another from loading and never stops the app from rendering.
 *
 * The browser's `import()`, the shared-package registry and `fetch` are
 * passed in, so a spec can run all of it in Node.
 */

import type { ClientGameIntegration } from '../integrations/types';
import { checkClientApi, validateModuleExport } from './contract';
import {
  entryProblem,
  errorText,
  failure,
  type LoadableModule,
  type ModuleFailure,
} from './manifest';

/** How long one module may take to import before it is "broken: timed out" (§4.2). */
export const IMPORT_TIMEOUT_MS = 10_000;

export type ModuleLoadResult =
  | { id: string; ok: true; integration: ClientGameIntegration }
  | { id: string; ok: false; failure: ModuleFailure };

export interface LoadDeps {
  /** This platform's client API version (`CLIENT_API_VERSION`). */
  platformClientApi: string;
  /** Ids a code module may not take: the built-ins compiled into this bundle. */
  takenIds: readonly string[];
  /** `(url) => import(url)` in the browser. */
  importModule: (url: string) => Promise<unknown>;
  /**
   * Makes the shared packages available to the shims. Called once, and only
   * when at least one module passed the checks that need no code.
   */
  prepareShared?: () => Promise<void>;
  /** For saying why an import failed (404, served as HTML, …). */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`did not load within ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * After `import()` failed: why, in words an admin can act on. The browser's
 * own error for a 404 and for HTML served as a module is the same
 * "Failed to fetch dynamically imported module", so ask the URL directly.
 */
async function diagnoseImport(
  url: string,
  error: unknown,
  fetchImpl: LoadDeps['fetchImpl'],
  timeoutMs: number
): Promise<ModuleFailure> {
  if (error instanceof TimeoutError) {
    const seconds = Math.round(error.ms / 1000);
    return failure('import', 'timeout', `its code did not load within ${seconds} s`, { seconds });
  }
  const text = errorText(error);
  if (fetchImpl) {
    try {
      const response = await withTimeout(fetchImpl(url, { cache: 'no-store' }), timeoutMs);
      if (response.status === 404) {
        return failure('import', 'notFound', `its code is missing (HTTP 404 for ${url})`, { url });
      }
      if (!response.ok) {
        return failure('import', 'httpError', `its code could not be fetched (HTTP ${response.status})`, {
          status: response.status,
          url,
        });
      }
      const type = response.headers.get('content-type') ?? '';
      if (!/javascript|ecmascript/i.test(type)) {
        return failure(
          'import',
          'notJavaScript',
          `its code is served as ${type || 'no content type'}, not JavaScript`,
          { contentType: type || '—', url }
        );
      }
    } catch {
      // Unreachable as well: the import error below says as much as we know.
    }
  }
  return failure('import', 'importFailed', `its code failed to load: ${text}`, { error: text });
}

export async function loadCodeModules(
  modules: readonly LoadableModule[],
  deps: LoadDeps
): Promise<ModuleLoadResult[]> {
  const timeoutMs = deps.timeoutMs ?? IMPORT_TIMEOUT_MS;

  // Refusals that need no code: a URL outside the module's static route, or a
  // client API range this platform is not in. These never reach import().
  const checked = modules.map((entry) => ({
    entry,
    refused:
      entryProblem(entry.id, entry.client.entry) ??
      checkClientApi(entry.clientApi, deps.platformClientApi),
  }));

  const toImport = checked.filter((item) => !item.refused);
  let sharedFailure: ModuleFailure | null = null;
  if (toImport.length > 0 && deps.prepareShared) {
    try {
      await withTimeout(deps.prepareShared(), timeoutMs);
    } catch (error) {
      sharedFailure = failure(
        'import',
        'sharedFailed',
        `the platform could not share its packages with modules: ${errorText(error)}`,
        { error: errorText(error) }
      );
    }
  }

  // allSettled semantics: each import is awaited on its own and turned into a
  // result, so nothing one module does can reject the whole batch.
  return Promise.all(
    checked.map(async ({ entry, refused }): Promise<ModuleLoadResult> => {
      if (refused) return { id: entry.id, ok: false, failure: refused };
      if (sharedFailure) return { id: entry.id, ok: false, failure: sharedFailure };

      let namespace: unknown;
      try {
        namespace = await withTimeout(deps.importModule(entry.client.entry), timeoutMs);
      } catch (error) {
        return {
          id: entry.id,
          ok: false,
          failure: await diagnoseImport(entry.client.entry, error, deps.fetchImpl, timeoutMs),
        };
      }

      const validated = validateModuleExport(namespace, entry.id, deps.takenIds);
      return validated.ok
        ? { id: entry.id, ok: true, integration: validated.integration }
        : { id: entry.id, ok: false, failure: validated.failure };
    })
  );
}
