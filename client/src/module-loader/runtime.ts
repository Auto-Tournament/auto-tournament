/**
 * The loader's lazy half: imported by `boot.ts` only when the server lists a
 * code module to load, so semver, the validator, the adapter and the
 * shared-package registry cost an instance without one nothing.
 */

import { CLIENT_API_VERSION } from '../module-sdk/version';
import { builtInIntegrationIds, registerCodeModule } from '../integrations/registry';
import { adaptCodeModule } from './adapt';
import { loadCodeModules } from './loadCodeModules';
import { errorText, failure, type LoadableModule } from './manifest';
import { recordFailure, recordLoaded } from './moduleState';
import { provideShared } from './sharedRegistry';

export async function loadAndRegister(modules: readonly LoadableModule[]): Promise<void> {
  const results = await loadCodeModules(modules, {
    platformClientApi: CLIENT_API_VERSION,
    takenIds: builtInIntegrationIds(),
    importModule: (url) => import(/* @vite-ignore */ url),
    prepareShared: provideShared,
    fetchImpl: (url, init) => fetch(url, { credentials: 'same-origin', ...init }),
  });

  for (const result of results) {
    if (!result.ok) {
      recordFailure(result.id, result.failure);
      continue;
    }
    try {
      registerCodeModule(adaptCodeModule(result.integration));
      recordLoaded(result.id);
    } catch (error) {
      recordFailure(
        result.id,
        failure('contract', 'idTaken', `it could not be registered: ${errorText(error)}`, {
          id: result.id,
        })
      );
    }
  }
}
