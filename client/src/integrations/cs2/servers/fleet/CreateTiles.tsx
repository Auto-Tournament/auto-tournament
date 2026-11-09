import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import {
  mono,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  withAlpha,
} from '../../../../module-sdk';
import type { FleetHostCommand } from '../../cs2.types';
import { createProgress, CREATE_STAGES } from '../createProgress';
import { StateMark } from './ServerTile';

const { color } = tokens;

/** A server csm is creating: a tile before it exists, so "Add servers" shows at once. */
export function CreatingTile({ n, command }: { n: number; command: FleetHostCommand }) {
  const { t } = useModuleTranslation('cs2');
  const name = t('serversBoard.newServer', { defaultValue: 'New server {{n}}', n });
  const p = createProgress(command.progress.step);
  let what =
    command.progress.step ?? t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' });
  if (p.phase) what = t(`serversBoard.create.phase.${p.phase}`);
  let amount: string | null = null;
  if (p.pct !== null && p.totalGb !== null && p.doneGb !== null)
    amount = t('serversBoard.create.amount', { pct: p.pct, done: p.doneGb, total: p.totalGb });
  else if (p.pct !== null) amount = t('serversBoard.create.amountPct', { pct: p.pct });
  let where: string | null = null;
  if (p.phase === 'waiting') where = t('serversBoard.create.waitingNote');
  else if (p.stage !== null)
    where = t('serversBoard.create.stage', { n: p.stage, count: CREATE_STAGES });
  const pct = command.progress.pct;
  return (
    <Box
      data-testid="machine-tile-creating"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        p: 1.5,
        pb: 2,
        minHeight: 92,
        borderRadius: radii.md,
        border: `1px dashed ${withAlpha(color.info, 0.6)}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Box component="span" sx={{ fontWeight: 600, fontSize: textSize.sm, color: color.ink2 }}>
          {name}
        </Box>
        <Box
          component="span"
          sx={{
            ml: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontSize: '0.75rem',
            color: color.info,
          }}
        >
          <StateMark state="starting" />
          {t('serversBoard.state.creating', { defaultValue: 'Creating…' })}
        </Box>
      </Box>
      <Box component="span" sx={{ fontSize: textSize.sm, fontWeight: 600 }}>
        {what}
      </Box>
      {amount && (
        <Box component="span" sx={{ ...mono, fontSize: '0.75rem', color: color.ink2 }}>
          {amount}
        </Box>
      )}
      {where && (
        <Box component="span" sx={{ fontSize: '0.75rem', color: color.muted }}>
          {where}
        </Box>
      )}
      {pct !== null && (
        <Box
          role="progressbar"
          aria-label={t('serversBoard.create.progressLabel', { name })}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 4,
            bgcolor: color.rule,
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${Math.max(4, pct)}%`,
              bgcolor: color.info,
              transition: 'width 240ms ease-out',
            }}
          />
        </Box>
      )}
    </Box>
  );
}

/** A create that failed, where its tile was: what went wrong, try again, and csm's log. */
export function FailedCreateTile({
  n,
  command,
  message,
  canRetry,
  onRetry,
}: {
  n: number;
  command: FleetHostCommand;
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const [log, setLog] = useState(false);
  // A stall names the step in the page's words, not csm's raw line.
  const stalledAt = createProgress(command.progress.step).phase;
  const text =
    command.errorCode === 'timeout' && stalledAt
      ? t('serversBoard.create.stalledAt', {
          what: t(`serversBoard.create.phase.${stalledAt}`),
        })
      : message;
  return (
    <Box
      data-testid="machine-tile-create-failed"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        p: 1.5,
        minHeight: 92,
        borderRadius: radii.md,
        border: `1px solid ${withAlpha(color.ban, 0.5)}`,
        bgcolor: withAlpha(color.ban, 0.06),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ fontWeight: 600, fontSize: textSize.sm, color: color.ink2 }}>
          {t('serversBoard.newServer', { defaultValue: 'New server {{n}}', n })}
        </Box>
        <Box component="span" sx={{ ml: 'auto', fontSize: '0.75rem', color: color.ban }}>
          {t('serversBoard.create.failed')}
        </Box>
      </Box>
      <Box component="span" sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
        {text}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 'auto' }}>
        <Button
          size="small"
          variant="outlined"
          disabled={!canRetry}
          onClick={onRetry}
          sx={{ borderRadius: radii.pill }}
        >
          {t('machinesPanel.tryAgain', { defaultValue: 'Try again' })}
        </Button>
        {command.output && (
          <Button size="small" onClick={() => setLog(true)} sx={{ borderRadius: radii.pill }}>
            {t('serversBoard.create.showLog')}
          </Button>
        )}
      </Box>
      <Dialog open={log} onClose={() => setLog(false)} fullWidth maxWidth="md">
        <DialogTitle>{t('serversBoard.create.logTitle')}</DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            sx={{
              ...mono,
              m: 0,
              p: 1.5,
              borderRadius: radii.md,
              bgcolor: color.paper,
              color: color.ink2,
              fontSize: '0.75rem',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {command.output}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLog(false)}>{t('serversBoard.create.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
