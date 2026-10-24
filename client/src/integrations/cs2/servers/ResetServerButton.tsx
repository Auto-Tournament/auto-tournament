/** Reset a Ready Up server: whatever it holds goes, so it can take the next match (api fleet/reset.ts). */
import { useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import {
  ConfirmDialog,
  api,
  apiErrorMessage,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { FleetServer } from '../cs2.types';

export interface ResetResult {
  ok: true;
  ended: 'assignment' | 'local' | 'none';
  settledMatchSlug: string | null;
}

export function ResetServerButton({
  server,
  onDone,
}: {
  server: FleetServer;
  onDone?: (res: ResetResult) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const slug = server.availabilityDetail;

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await api.post<ResetResult>(`/api/fleet/servers/${server.id}/reset`);
      setOpen(false);
      showSnackbar(
        res.settledMatchSlug
          ? t('fleetPanel.reset.doneMatch', {
              name: server.name,
              slug: res.settledMatchSlug,
            })
          : t('fleetPanel.reset.done', { name: server.name }),
        'success'
      );
      onDone?.(res);
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.reset.failed')));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={t('fleetPanel.reset.action')}>
        <span>
          <IconButton
            size="small"
            onClick={() => setOpen(true)}
            disabled={!server.online || busy}
            aria-label={t('fleetPanel.reset.action')}
            data-testid={`fleet-reset-${server.id}`}
          >
            <ArrowCounterClockwiseIcon size={20} />
          </IconButton>
        </span>
      </Tooltip>
      <ConfirmDialog
        open={open}
        title={t('fleetPanel.reset.title', { name: server.name })}
        message={
          slug ? t('fleetPanel.reset.messageMatch', { slug }) : t('fleetPanel.reset.message')
        }
        confirmLabel={t('fleetPanel.reset.action')}
        confirmColor="warning"
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
