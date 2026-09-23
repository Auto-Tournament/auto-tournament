/**
 * The setup page's way out of a start Steam refused because some servers are
 * out of date (3.0 phase E).
 *
 * The same refusal as `Cs2OutdatedServersDialog`, recognised by the same
 * `parseCs2OutdatedError`, but worded the way the setup page has always worded
 * it: the `tournament.outdatedServers.*` keys, translated into all ten
 * locales, and a plain Cancel that leaves the admin on the page they were
 * setting up rather than sending them to the Servers page.
 *
 * Moved out of `pages/Tournament.tsx` unchanged. It is a second component
 * rather than a second use of the first because the two surfaces have always
 * said this differently; making them agree is a copy change for every CS2
 * install, which is not what this is.
 */

import React, { useState } from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../../components/modals/ConfirmDialog';
import { api } from '../../../utils/api';
import { parseCs2OutdatedError } from './Cs2OutdatedServersDialog';
import type { TournamentStartFailureProps } from '../../types';

export const Cs2SetupOutdatedServersDialog: React.FC<TournamentStartFailureProps> = ({
  error,
  onClose,
  onRetry,
  onError,
}) => {
  const { t } = useTranslation();
  const [disablingOutdated, setDisablingOutdated] = useState(false);
  const outdatedServers = parseCs2OutdatedError(error) ?? [];

  return (
    <ConfirmDialog
      open={outdatedServers.length > 0}
      title={t('tournament.outdatedServers.title')}
      message={
        <>
          <Box sx={{ mb: 1 }}>{t('tournament.outdatedServers.body')}</Box>
          <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2 }}>
            {outdatedServers.map((s) => (
              <li key={s.id}>
                {s.name} ({s.id})
                {typeof s.installedBuildId === 'number' ? ` — installed=${s.installedBuildId}` : ''}
                {typeof s.requiredVersion === 'number' ? `, required=${s.requiredVersion}` : ''}
                {s.reason ? ` — ${s.reason}` : ''}
              </li>
            ))}
          </Box>
        </>
      }
      confirmLabel={
        disablingOutdated
          ? t('tournament.outdatedServers.disabling')
          : t('tournament.outdatedServers.confirm')
      }
      cancelLabel={t('common.cancel')}
      confirmColor="warning"
      loading={disablingOutdated}
      onCancel={onClose}
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
