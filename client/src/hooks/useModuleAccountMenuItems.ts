import { useEffect, useState } from 'react';
import { useInstalledIntegrations } from '../integrations/registry';
import type { AccountMenuItem } from '../integrations/types';

export interface ModuleAccountMenuItem extends AccountMenuItem {
  moduleId: string;
}

/**
 * The account menu's links from installed modules (`accountMenuItems`; CS2:
 * Inventory while skins are on), asked for again when the signed-in player
 * changes. A module that throws adds none.
 */
export function useModuleAccountMenuItems(playerKey: string | null): ModuleAccountMenuItem[] {
  const integrations = useInstalledIntegrations();
  const [items, setItems] = useState<ModuleAccountMenuItem[]>([]);
  const sources = integrations.filter((integration) => integration.accountMenuItems);
  const sourceKey = sources.map((integration) => integration.id).join(' ');

  useEffect(() => {
    let cancelled = false;
    if (!playerKey || sources.length === 0) {
      Promise.resolve().then(() => !cancelled && setItems([]));
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      sources.map((integration) =>
        integration.accountMenuItems!()
          .then((list) => list.map((item) => ({ ...item, moduleId: integration.id })))
          .catch(() => [])
      )
    ).then((lists) => !cancelled && setItems(lists.flat()));
    return () => {
      cancelled = true;
    };
    // `sources` follows `sourceKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerKey, sourceKey]);

  return items;
}
