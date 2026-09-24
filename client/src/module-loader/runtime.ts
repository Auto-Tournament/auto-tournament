/**
 * The loader's lazy half: imported by `boot.ts` only when the server lists a
 * code module to load, so the range check, the validator, the adapter and the
 * shared-package registry cost an instance without one nothing.
 */

import { CLIENT_API_VERSION } from '../module-sdk/version';
import { builtInIntegrationIds, registerCodeModule } from '../integrations/registry';
import { adaptCodeModule } from './adapt';
import { loadCodeModules } from './loadCodeModules';
import { errorText, failure, type LoadableModule } from './manifest';
import { recordFailure, recordLoaded } from './moduleState';
import { provideShared } from './sharedRegistry';
import { registerModuleLocales } from './moduleLocales';
import i18n from '../i18n';

export async function loadAndRegister(modules: readonly LoadableModule[]): Promise<void> {
  const results = await loadCodeModules(modules, {
    platformClientApi: CLIENT_API_VERSION,
    takenIds: builtInIntegrationIds(),
    importModule: (url) => import(/* @vite-ignore */ url),
    prepareShared: provideShared,
    // Module files are public (players render slots too): a plain fetch.
    fetchImpl: (url, init) => fetch(url, init),
  });

  for (const result of results) {
    if (!result.ok) {
      recordFailure(result.id, result.failure);
      continue;
    }
    try {
      registerCodeModule(adaptCodeModule(result.integration));
      // Its strings, once it holds its id: boot is not over yet, so they are
      // in place before its first slot renders.
      registerModuleLocales(i18n, result.id, result.integration.locales);
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
