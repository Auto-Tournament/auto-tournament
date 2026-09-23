/**
 * The setup page's own dialogs: delete, regenerate, reset.
 *
 * The start confirmation used to be the fourth, and it was three variants of
 * "there are not enough servers" with a **Check Servers** way out — a question
 * only a game with servers can be asked. It is now the game module's
 * `tournamentStart.preflight` (see `integrations/types.ts`), so a tournament
 * that runs on nothing is not asked it (3.0 phase E).
 */

import React from 'react';
import { Typography, Box } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import ConfirmDialog from '../modals/ConfirmDialog';

interface TournamentDialogsProps {
  deleteOpen: boolean;
  regenerateOpen: boolean;
  resetOpen: boolean;
  tournamentName?: string;
  tournamentStatus?: string;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onRegenerateConfirm: () => void;
  onRegenerateCancel: () => void;
  onResetConfirm: () => void;
  onResetCancel: () => void;
}

export const TournamentDialogs: React.FC<TournamentDialogsProps> = ({
  deleteOpen,
  regenerateOpen,
  resetOpen,
  tournamentName,
  tournamentStatus,
  onDeleteConfirm,
  onDeleteCancel,
  onRegenerateConfirm,
  onRegenerateCancel,
  onResetConfirm,
  onResetCancel,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <ConfirmDialog
        open={deleteOpen}
        title={t('tournament.dialogs.delete.title')}
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              <Trans
                i18nKey="tournament.dialogs.delete.question"
                values={{ name: tournamentName }}
                components={{ b: <strong /> }}
              />
            </Typography>
            <Typography variant="body2" fontWeight={600} color="error.main" gutterBottom>
              {t('tournament.dialogs.delete.willTitle')}
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.items.endMatches')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.delete.items.removeTournament')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.items.deleteMatches')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.items.deleteData')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                <strong>{t('tournament.dialogs.delete.items.cannotBeUndone')}</strong>
              </Typography>
            </Box>
            <Typography variant="body2" color="info.main" sx={{ fontStyle: 'italic' }}>
              {t('tournament.dialogs.delete.note')}
            </Typography>
          </>
        }
        confirmLabel={t('tournament.dialogs.delete.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
        confirmColor="error"
      />

      <ConfirmDialog
        open={regenerateOpen}
        title={t('tournament.dialogs.regenerate.title')}
        message={
          tournamentStatus !== 'setup' ? (
            <>
              <Typography variant="body2" fontWeight={600} color="error.main" paragraph>
                {t('tournament.dialogs.regenerate.liveWarning', {
                  status: tournamentStatus?.toUpperCase(),
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                <Trans
                  i18nKey="tournament.dialogs.regenerate.liveBody"
                  components={{ b: <strong /> }}
                />
              </Typography>
              <Typography variant="body2" color="error.main" fontWeight={600}>
                {t('tournament.dialogs.regenerate.cannotBeUndone')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t('tournament.dialogs.regenerate.areYouSure')}
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" paragraph>
                {t('tournament.dialogs.regenerate.setupBody')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('tournament.dialogs.regenerate.continue')}
              </Typography>
            </>
          )
        }
        confirmLabel={
          tournamentStatus !== 'setup'
            ? t('tournament.dialogs.regenerate.confirmDestructive')
            : t('tournament.dialogs.regenerate.confirm')
        }
        cancelLabel={t('common.cancel')}
        onConfirm={onRegenerateConfirm}
        onCancel={onRegenerateCancel}
        confirmColor="error"
      />

      <ConfirmDialog
        open={resetOpen}
        title={t('tournament.dialogs.reset.title')}
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              <Trans
                i18nKey="tournament.dialogs.reset.question"
                values={{ name: tournamentName }}
                components={{ b: <strong /> }}
              />
            </Typography>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              {t('tournament.dialogs.reset.willTitle')}
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.items.endMatches')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.reset.items.clearStatus')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.reset.items.regenerateMatches')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.items.deleteData')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                <Trans
                  i18nKey="tournament.dialogs.reset.items.keepSettings"
                  components={{ b: <strong /> }}
                />
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('tournament.dialogs.reset.items.allowEdit')}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" paragraph>
              {t('tournament.dialogs.reset.regenerated')}
            </Typography>
            <Typography variant="body2" color="info.main" sx={{ fontStyle: 'italic' }}>
              {t('tournament.dialogs.reset.note')}
            </Typography>
          </>
        }
        confirmLabel={t('tournament.dialogs.reset.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={onResetConfirm}
        onCancel={onResetCancel}
        confirmColor="warning"
      />

    </>
  );
};
