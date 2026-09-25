import React, { useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { Panel, Row, RowList } from '../common/ui';
import { tokens } from '../../theme/tokens';
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

// The draft's `.kind` dots: red for something broken, the accent for a
// decision, muted for information.
const severityDotColor: Record<NeedsYouItem['severity'], string> = {
  ban: tokens.color.ban,
  warn: tokens.color.accent,
  info: tokens.color.muted,
};

/** The draft's `.queue li`: dot, what, actions; the actions wrap under "what" on a phone. */
const queueRowColumns = { xs: 'auto minmax(0, 1fr)', sm: 'auto minmax(0, 1fr) auto' };

/** The queue's 10px dot. */
export function KindDot({ color }: { color: string }) {
  return (
    <Box
      aria-hidden
      sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }}
    />
  );
}

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
        <Panel sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('managePage.needsYou.empty')}
          </Typography>
        </Panel>
      ) : (
        <RowList aria-label={t('managePage.needsYou.listLabel')}>
          {items.map((item) => (
            <Row key={item.id} columns={queueRowColumns}>
              <KindDot color={severityDotColor[item.severity]} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body1" fontWeight={600}>
                  {item.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.detail}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  flexWrap: 'wrap',
                  justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                  gridColumn: { xs: 2, sm: 'auto' },
                }}
              >
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
              </Box>
            </Row>
          ))}
        </RowList>
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
