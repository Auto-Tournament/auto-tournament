import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Alert, Box } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import ConfirmDialog from '../modals/ConfirmDialog';
import { paths } from '../../paths';

interface TournamentDialogsProps {
  deleteOpen: boolean;
  regenerateOpen: boolean;
  resetOpen: boolean;
  startOpen: boolean;
  tournamentName?: string;
  tournamentStatus?: string;
  startWarning?: {
    requiredServers: number;
    availableServers: number;
  };
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onRegenerateConfirm: () => void;
  onRegenerateCancel: () => void;
  onResetConfirm: () => void;
  onResetCancel: () => void;
  onStartConfirm: () => void;
  onStartCancel: () => void;
}

export const TournamentDialogs: React.FC<TournamentDialogsProps> = ({
  deleteOpen,
  regenerateOpen,
  resetOpen,
  startOpen,
  tournamentName,
  tournamentStatus,
   startWarning,
  onDeleteConfirm,
  onDeleteCancel,
  onRegenerateConfirm,
  onRegenerateCancel,
  onResetConfirm,
  onResetCancel,
  onStartConfirm,
  onStartCancel,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const requiredServers = startWarning?.requiredServers ?? 0;
  const availableServers = startWarning?.availableServers ?? 0;
  const hasServerCounts = requiredServers > 0;
  const noServers = hasServerCounts && availableServers === 0;
  const insufficientServers =
    hasServerCounts && availableServers > 0 && availableServers < requiredServers;

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

      <ConfirmDialog
        open={startOpen}
        title={
          noServers
            ? t('tournament.dialogs.start.titleNoServers')
            : insufficientServers
            ? t('tournament.dialogs.start.titleInsufficient')
            : t('tournament.dialogs.start.titleUncertain')
        }
        message={
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {noServers && (
                <>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    {t('tournament.dialogs.start.noServersHeading')}
                  </Typography>
                  <Typography variant="body2">
                    {t('tournament.dialogs.start.noServersBody')}
                  </Typography>
                </>
              )}
              {insufficientServers && (
                <>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    {t('tournament.dialogs.start.insufficientHeading')}
                  </Typography>
                  <Typography variant="body2">
                    <Trans
                      i18nKey="tournament.dialogs.start.insufficientBody"
                      values={{
                        available: t('tournament.counts.availableServers', {
                          count: availableServers,
                        }),
                        required: t('tournament.counts.concurrentMatches', {
                          count: requiredServers,
                        }),
                      }}
                      components={{ b: <strong /> }}
                    />
                  </Typography>
                </>
              )}
              {!noServers && !insufficientServers && (
                <>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    {t('tournament.dialogs.start.uncertainHeading')}
                  </Typography>
                  <Typography variant="body2">
                    {t('tournament.dialogs.start.uncertainBody')}
                  </Typography>
                </>
              )}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              {t('tournament.dialogs.start.question')}
            </Typography>
          </>
        }
        confirmLabel={t('tournament.dialogs.start.confirm')}
        cancelLabel={t('tournament.dialogs.start.cancel')}
        onConfirm={onStartConfirm}
        onCancel={() => {
          onStartCancel();
          navigate(paths.servers);
        }}
        confirmColor="warning"
      />
    </>
  );
};
