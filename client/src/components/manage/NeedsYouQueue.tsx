import React, { useState } from 'react';
import { Box, Paper, List, ListItem, Typography, Button, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import ConfirmDialog from '../modals/ConfirmDialog';
import type { NeedsYouAction, NeedsYouItem } from '../../utils/manageSelectors';

interface NeedsYouQueueProps {
  items: NeedsYouItem[];
  /** Opens the existing MatchDetailsModal (its own UI drives the decide/set-winner flow). */
  onDecide: (matchSlug: string) => void;
  onActionDone: () => void;
}

const severityDotColor: Record<NeedsYouItem['severity'], string> = {
  ban: 'error.main',
  warn: 'warning.main',
  info: 'text.secondary',
};

/**
 * The "needs you" queue: matches waiting on an admin decision, plus servers
 * the allocator/status checks have already flagged as stale or offline
 * while carrying a match. Every action here calls an endpoint that already
 * exists for AdminMatchControls (`/winner`, `/reallocate`, `/force-cancel`).
 */
export const NeedsYouQueue: React.FC<NeedsYouQueueProps> = ({ items, onDecide, onActionDone }) => {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [pendingAction, setPendingAction] = useState<NeedsYouAction | null>(null);
  const [executing, setExecuting] = useState(false);

  const runAction = async (action: NeedsYouAction) => {
    setExecuting(true);
    try {
      if (action.kind === 'reallocate') {
        await api.post(`/api/matches/${action.matchSlug}/reallocate`, {});
        showSuccess(t('managePage.needsYou.reallocateSuccess'));
      } else if (action.kind === 'forceCancel') {
        await api.post(`/api/matches/${action.matchSlug}/force-cancel`, {});
        showSuccess(t('managePage.needsYou.forceCancelSuccess'));
      }
      onActionDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('managePage.needsYou.actionFailed');
      showError(message);
    } finally {
      setExecuting(false);
      setPendingAction(null);
    }
  };

  const handleActionClick = (action: NeedsYouAction) => {
    if (action.kind === 'decide') {
      onDecide(action.matchSlug);
      return;
    }
    setPendingAction(action);
  };

  return (
    <Box data-testid="manage-needs-you">
      {items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('managePage.needsYou.empty')}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {items.map((item, index) => (
              <ListItem
                key={item.id}
                divider={index < items.length - 1}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                  py: 1.5,
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: severityDotColor[item.severity],
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" fontWeight={600}>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.detail}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {item.actions.map((action, actionIndex) => (
                    <Button
                      key={actionIndex}
                      size="small"
                      variant={actionIndex === 0 ? 'contained' : 'outlined'}
                      color={action.kind === 'forceCancel' ? 'error' : 'primary'}
                      onClick={() => handleActionClick(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </Stack>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        title={
          pendingAction?.kind === 'forceCancel'
            ? t('managePage.needsYou.forceCancelConfirmTitle')
            : t('managePage.needsYou.reallocateConfirmTitle')
        }
        message={
          pendingAction?.kind === 'forceCancel'
            ? t('managePage.needsYou.forceCancelConfirmBody')
            : t('managePage.needsYou.reallocateConfirmBody')
        }
        confirmColor={pendingAction?.kind === 'forceCancel' ? 'error' : 'warning'}
        confirmLabel={pendingAction?.label}
        loading={executing}
        onConfirm={() => pendingAction && runAction(pendingAction)}
        onCancel={() => setPendingAction(null)}
      />
    </Box>
  );
};
