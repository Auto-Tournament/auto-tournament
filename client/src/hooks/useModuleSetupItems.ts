import { useEffect, useState } from 'react';
import { listIntegrations } from '../integrations/registry';
import type { AdminHomeSetupItem, ClientGameIntegration } from '../integrations/types';

/** A module's setup row, with the namespace its label key is in. */
export type ModuleSetupItem = AdminHomeSetupItem & { ns: string };

/**
 * The admin home's "Finish setting up" rows that the shell's modules add
 * (client API 0.2.0). CS2 adds its server row: it counts its own servers, so
 * core no longer asks `/api/servers` on its behalf.
 *
 * `modules` is the shell's module list, or null while the shell is still
 * finding out which modules that is; the answer stays loading until then.
 */
export function useModuleSetupItems(modules: ClientGameIntegration[] | null): {
  items: ModuleSetupItem[];
  loading: boolean;
} {
  // The shell hands out a new array each render; its ids are what matter.
  const moduleKey = modules === null ? null : modules.map((integration) => integration.id).join('\n');
  const [answer, setAnswer] = useState<{ key: string; items: ModuleSetupItem[] } | null>(null);

  useEffect(() => {
    if (moduleKey === null) return;
    let cancelled = false;
    const ids = moduleKey.split('\n');
    const sources = listIntegrations().filter(
      (integration) => ids.includes(integration.id) && integration.adminHomeSetup
    );

    void Promise.all(
      sources.map(async (integration) => {
        try {
          const rows = (await integration.adminHomeSetup?.()) ?? [];
          return rows.map((row) => ({ ...row, ns: integration.id }));
        } catch {
          return [];
        }
      })
    ).then((perModule) => {
      if (!cancelled) setAnswer({ key: moduleKey, items: perModule.flat() });
    });

    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  const current = answer !== null && answer.key === moduleKey ? answer : null;
  return { items: current?.items ?? [], loading: current === null };
}
