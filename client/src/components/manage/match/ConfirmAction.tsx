import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { radii, textSize, tokens } from '../../../theme/tokens';

const { color } = tokens;

export type ActionTarget = 'match' | 'server' | 'tournament';

const TARGET_LABEL: Record<ActionTarget, string> = {
  match: 'Match · Ready Up',
  server: 'Server',
  tournament: 'Tournament · platform',
};

export interface ConfirmActionSpec {
  target: ActionTarget;
  /** The question: "Restart map 2 (Overpass) from round 1?" */
  title: string;
  body?: string;
  /** What changes, and for whom. */
  effects: string[];
  /** The main button: the exact action ("Restart map 2 from round 1"), never "Confirm". */
  action: string;
  /** What the other button keeps ("Keep playing"). */
  cancel: string;
  danger?: boolean;
  /** Destructive actions: the admin types this to enable the button. */
  typeToConfirm?: string;
  run: () => Promise<unknown>;
}

/**
 * Every admin action on the match page asks first: the title is the question,
 * the list says what changes and for whom, and the main button repeats the
 * exact action. Ending a series or cancelling a match also needs the match's
 * name typed.
 */
export function ConfirmAction({
  spec,
  onClose,
}: {
  spec: ConfirmActionSpec | null;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  if (!spec) return null;
  const blocked = Boolean(spec.typeToConfirm) && typed.trim() !== spec.typeToConfirm;
  const close = () => {
    setTyped('');
    onClose();
  };
  const run = async () => {
    setBusy(true);
    try {
      await spec.run();
      close();
    } finally {
      setBusy(false);
    }
  };
  const accent = spec.danger
    ? color.ban
    : spec.target === 'server'
      ? color.info
      : spec.target === 'tournament'
        ? color.live
        : color.accent;
  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth data-testid="manage-confirm">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography
          component="span"
          sx={{
            display: 'block',
            fontSize: textSize.xs,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: accent,
            mb: 1,
          }}
        >
          {TARGET_LABEL[spec.target]}
        </Typography>
        {spec.title}
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        {spec.body && <Typography sx={{ color: color.ink2 }}>{spec.body}</Typography>}
        {spec.effects.length > 0 && (
          <Box
            component="ul"
            sx={{ m: 0, py: 1.5, pr: 2, pl: 4, borderRadius: radii.md, bgcolor: color.paper3 }}
          >
            {spec.effects.map((e) => (
              <li key={e}>
                <Typography sx={{ fontSize: textSize.sm }}>{e}</Typography>
              </li>
            ))}
          </Box>
        )}
        {spec.typeToConfirm && (
          <TextField
            label={`Type “${spec.typeToConfirm}” to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            inputProps={{ 'data-testid': 'manage-confirm-type' }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={close} variant="outlined">
          {spec.cancel}
        </Button>
        <Button
          onClick={() => void run()}
          variant="contained"
          disabled={busy || blocked}
          color={spec.danger ? 'error' : 'primary'}
          data-testid="manage-confirm-action"
        >
          {spec.action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
