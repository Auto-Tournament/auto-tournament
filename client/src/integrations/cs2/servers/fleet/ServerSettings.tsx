import { useState } from 'react';
import { Button } from '@mui/material';
import { GearSixIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation, useSnackbar } from '../../../../module-sdk';
import type { Server } from '../../cs2.types';
import ServerModal from '../ServerModal';

/** Opens the server settings dialog of the Ready Up server linked as `linkedId`. */
export function ServerSettings({ linkedId }: { linkedId: string }) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [editing, setEditing] = useState<{ server: Server; all: Server[] } | null>(null);
  const edit = async () => {
    try {
      const res = await api.get<{ servers?: Server[] }>('/api/servers');
      const all = res.servers ?? [];
      const server = all.find((x) => x.id === linkedId);
      if (server) setEditing({ server, all });
    } catch (err) {
      showError(err instanceof Error ? err.message : t('serverModal.errors.saveFailed'));
    }
  };
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<GearSixIcon />}
        onClick={() => void edit()}
        data-testid="server-sheet-settings"
      >
        {t('serversBoard.settings')}
      </Button>
      <ServerModal
        open={editing !== null}
        server={editing?.server ?? null}
        servers={editing?.all ?? []}
        onClose={() => setEditing(null)}
        onSave={() => setEditing(null)}
      />
    </>
  );
}
