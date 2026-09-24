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
 * One dialog, two surfaces. The dashboard button and the setup page each used
 * to have their own version of this — #311 moved the dashboard's literal
 * English out of `StartTournamentButton.tsx`, #312 moved the setup page's
 * translated one out of `pages/Tournament.tsx`, and both landed here side by
 * side because making them agree changes copy for a CS2 install. This is that
 * change, made deliberately: it is the same refusal about the same servers, so
 * it now reads the same wherever a start runs into it, and it keeps the better
 * half of each — the `tournament.outdatedServers.*` keys the setup page had in
 * all ten locales, and the dashboard's way out to the Servers page, which is
 * where an admin goes to update the servers this dialog has just named.
 */

import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog, api, links, useModuleTranslation } from '../../../module-sdk';
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
  const { t } = useModuleTranslation('cs2');
  const [disablingOutdated, setDisablingOutdated] = useState(false);
  const outdatedServers = parseCs2OutdatedError(error) ?? [];

  return (
    <ConfirmDialog
      open={outdatedServers.length > 0}
      title={t('tournament.outdatedServers.title')}
      message={
        <>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('tournament.outdatedServers.body')}
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
      confirmLabel={
        disablingOutdated
          ? t('tournament.outdatedServers.disabling')
          : t('tournament.outdatedServers.confirm')
      }
      cancelLabel={t('tournament.outdatedServers.goToServers')}
      confirmColor="warning"
      loading={disablingOutdated}
      onCancel={() => {
        onClose();
        navigate(links.servers());
      }}
      onConfirm={async () => {
        if (disablingOutdated) return;
        setDisablingOutdated(true);
        try {
          for (const s of outdatedServers) {
            await api.post(`/api/servers/${s.id}/disable`);
          }
          onClose();
          // Retry immediately (the start runs its preflight again with the
          // remaining enabled servers).
          await onRetry();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          onError(t('tournament.toasts.disableServersFailed', { message: msg }));
        } finally {
          setDisablingOutdated(false);
        }
      }}
    />
  );
};
