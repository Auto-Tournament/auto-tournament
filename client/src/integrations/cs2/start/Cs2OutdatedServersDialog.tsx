/**
 * The way out of a start the API refused because Steam says some servers are
 * out of date (3.0 phase E).
 *
 * `cs2_outdated_servers` is a CS2 error code about CS2 build ids, answered by
 * disabling CS2 servers, so both the parsing and the dialog live here. The
 * core start button asks `ownsFailure` whether this module recognises a
 * refusal and renders this in place of its error snackbar when it does;
 * everything else, for every game, is still the snackbar.
 *
 * Moved from `components/dashboard/StartTournamentButton.tsx` unchanged.
 */

import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../../../components/modals/ConfirmDialog';
import { api } from '../../../utils/api';
import { paths } from '../../../paths';
import type { TournamentStartFailureProps } from '../../types';

export interface OutdatedServer {
  id: string;
  name: string;
  installedBuildId: number | null;
  requiredVersion: number | null;
  reason: string;
}

/**
 * The servers an outdated-servers refusal named, or `null` when the message is
 * some other failure. Used both to claim the failure and to list them.
 */
export function parseCs2OutdatedError(raw: string): OutdatedServer[] | null {
  try {
    const parsed = JSON.parse(raw) as { errorCode?: unknown; servers?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.errorCode !== 'cs2_outdated_servers') return null;
    const servers = Array.isArray(parsed.servers) ? (parsed.servers as unknown[]) : [];
    const cleaned = servers
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
      .map((s) => ({
        id: String(s.id ?? ''),
        name: String(s.name ?? ''),
        installedBuildId: typeof s.installedBuildId === 'number' ? s.installedBuildId : null,
        requiredVersion: typeof s.requiredVersion === 'number' ? s.requiredVersion : null,
        reason: String(s.reason ?? 'Unknown reason'),
      }))
      .filter((s) => s.id && s.name);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

export const Cs2OutdatedServersDialog: React.FC<TournamentStartFailureProps> = ({
  error,
  onClose,
  onRetry,
  onError,
}) => {
  const navigate = useNavigate();
  const [disablingOutdated, setDisablingOutdated] = useState(false);
  const outdatedServers = parseCs2OutdatedError(error) ?? [];

  return (
    <ConfirmDialog
      open={outdatedServers.length > 0}
      title="Servers need update"
      message={
        <>
          <Typography variant="body2" color="text.secondary" paragraph>
            One or more enabled servers are out of date (or could not be verified) according to
            Steam. Update them, or disable them to continue with the remaining fleet.
          </Typography>
          <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2 }}>
            {outdatedServers.map((s) => (
              <Typography
                key={s.id}
                component="li"
                variant="body2"
                color="text.secondary"
                sx={{ mb: 0.5 }}
              >
                <strong>{s.name}</strong> ({s.id})
                {typeof s.installedBuildId === 'number' ? ` — installed=${s.installedBuildId}` : ''}
                {typeof s.requiredVersion === 'number' ? `, required=${s.requiredVersion}` : ''}
                {s.reason ? ` — ${s.reason}` : ''}
              </Typography>
            ))}
          </Box>
        </>
      }
      confirmLabel={disablingOutdated ? 'Disabling...' : 'Disable affected servers & retry'}
      cancelLabel="Go to Servers"
      confirmColor="warning"
      loading={disablingOutdated}
      onCancel={() => {
        onClose();
        navigate(paths.servers);
      }}
      onConfirm={async () => {
        if (disablingOutdated) return;
        setDisablingOutdated(true);
        try {
          for (const s of outdatedServers) {
            await api.post(`/api/servers/${s.id}/disable`);
          }
          onClose();
          // Retry immediately (will run preflight again with the remaining
          // enabled servers).
          await onRetry();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          onError(`Failed to disable one or more servers: ${msg}`);
        } finally {
          setDisablingOutdated(false);
        }
      }}
    />
  );
};
