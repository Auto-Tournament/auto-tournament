/**
 * The `resourceDialogs` slots: adding servers from outside the Servers page
 * (the tournament setup's "not enough servers" buttons).
 *
 * Core only opens them (client API 0.2.0). The dialogs check a new server
 * against the ones that exist, so they read the list themselves: once when
 * they mount, so it is there by the time an admin opens one, again each time
 * one opens, and again after a save.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../module-sdk';
import type { ResourceDialogProps } from '../../types';
import type { Server, ServersResponse } from '../cs2.types';
import ServerModal from './ServerModal';
import BatchServerModal from './BatchServerModal';

function useServerList(open: boolean): { servers: Server[]; reload: () => Promise<void> } {
  const [servers, setServers] = useState<Server[]>([]);

  const reload = useCallback(
    () =>
      api
        .get<ServersResponse>('/api/servers')
        .then((response) => setServers(response.servers || []))
        .catch((err) => console.error('Failed to load servers:', err)),
    []
  );

  useEffect(() => {
    void reload();
  }, [reload, open]);

  return { servers, reload };
}

/** `resourceDialogs.add`: one new server. */
export function AddServerDialog({ open, onClose, onSaved }: ResourceDialogProps) {
  const { servers, reload } = useServerList(open);
  return (
    <ServerModal
      open={open}
      server={null}
      servers={servers}
      onClose={onClose}
      onSave={() => {
        void reload();
        onSaved();
      }}
    />
  );
}

/** `resourceDialogs.batchAdd`: several new servers at once. */
export function BatchAddServersDialog({ open, onClose, onSaved }: ResourceDialogProps) {
  const { servers, reload } = useServerList(open);
  return (
    <BatchServerModal
      open={open}
      existingServers={servers}
      onClose={onClose}
      onSave={() => {
        void reload();
        onSaved();
      }}
    />
  );
}
