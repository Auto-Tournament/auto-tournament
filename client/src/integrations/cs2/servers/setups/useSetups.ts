import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage, useModuleTranslation, useSnackbar } from '../../../../module-sdk';
import type { PluginSetValue } from '../fleetPush.types';

export interface ServerSetup {
  id: string;
  name: string;
  plugins: PluginSetValue;
  maps: string[];
}

export interface SetupRun {
  setupId: string;
  /** The server's fleet id. */
  serverId: string;
  startedAt: number;
}

/** The saved setups and which run where (GET /api/game/cs2/setups), for the Servers page. */
export function useSetups() {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [setups, setSetups] = useState<ServerSetup[] | null>(null);
  const [running, setRunning] = useState<SetupRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.get<{ setups: ServerSetup[]; running: SetupRun[] }>(
        '/api/game/cs2/setups'
      );
      setSetups(r.setups);
      setRunning(r.running);
    } catch (error) {
      showError(apiErrorMessage(error, t('setups.loadFailed')));
      setSetups([]);
    }
  }, [showError, t]);
  useEffect(() => {
    const id = setTimeout(() => void reload(), 0);
    return () => clearTimeout(id);
  }, [reload]);

  /** Start (`/setups/:id/start`) or stop (`/setups/running/:server/stop`), then reload. */
  const act = useCallback(
    async (key: string, url: string) => {
      setBusy(key);
      try {
        await api.post(url, {});
        await reload();
      } catch (error) {
        showError(apiErrorMessage(error, t('setups.actionFailed')));
      } finally {
        setBusy(null);
      }
    },
    [reload, showError, t]
  );

  const stop = useCallback(
    (serverId: string) =>
      act(serverId, `/api/game/cs2/setups/running/${encodeURIComponent(serverId)}/stop`),
    [act]
  );

  /** The setup running on a server (by its fleet id), if one is. */
  const setupOn = useCallback(
    (serverId: string | null | undefined) => {
      const run = serverId ? running.find((r) => r.serverId === serverId) : undefined;
      const setup = run ? setups?.find((s) => s.id === run.setupId) : undefined;
      return run && setup ? { run, setup } : null;
    },
    [running, setups]
  );

  return { setups, running, busy, reload, act, stop, setupOn };
}

export type Setups = ReturnType<typeof useSetups>;
