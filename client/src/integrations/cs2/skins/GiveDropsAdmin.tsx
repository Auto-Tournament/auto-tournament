import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  api,
  useSnackbar,
  useModuleTranslation,
  tokens,
  radii,
  fontDisplay,
} from '../../../module-sdk';

const { color } = tokens;

type Kind = 'online' | 'player' | 'team' | 'match';

/**
 * Give a drop now (a choice of three) to one player, everyone online, a team
 * or a match's players. It asks first, naming how many get one; each drop
 * waits for its player and opens on their next page view.
 */
export function GiveDropsAdmin({ onGiven }: { onGiven?: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [kind, setKind] = useState<Kind>('online');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ count: number; names: string[] } | null>(null);

  const target = kind === 'online' ? { kind } : { kind, id: id.trim() };
  const needsId = kind !== 'online';

  const preview = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ count: number; names: string[] }>('/api/skins/admin/drops', {
        target,
        preview: true,
      });
      setConfirm({ count: r.count, names: r.names });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const give = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ given: number }>('/api/skins/admin/drops', { target });
      showSuccess(t('skins.admin.drops.given', { count: r.given }));
      setConfirm(null);
      onGiven?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const who = (count: number) =>
    kind === 'online'
      ? t('skins.admin.drops.whoOnline', { count })
      : kind === 'team'
        ? t('skins.admin.drops.whoTeam', { count })
        : kind === 'match'
          ? t('skins.admin.drops.whoMatch', { count })
          : t('skins.admin.drops.whoPlayer', { count });

  return (
    <Box
      component="section"
      aria-labelledby="give-drops-title"
      data-testid="give-drops"
      sx={{
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        borderRadius: radii.lg,
        p: { xs: 2, md: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      <Box>
        <Typography
          id="give-drops-title"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.1875rem', fontWeight: 600 }}
        >
          {t('skins.admin.drops.title')}
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {t('skins.admin.drops.help')}
        </Typography>
      </Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={kind}
        onChange={(_, v: Kind | null) => v && setKind(v)}
        aria-label={t('skins.admin.drops.title')}
        sx={{ flexWrap: 'wrap' }}
      >
        {(['online', 'player', 'team', 'match'] as const).map((k) => (
          <ToggleButton key={k} value={k} data-testid={`give-drops-${k}`}>
            {t(`skins.admin.drops.kind.${k}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {needsId && (
        <TextField
          size="small"
          value={id}
          onChange={(e) => setId(e.target.value)}
          label={t(`skins.admin.drops.idLabel.${kind}`)}
          inputProps={{ 'data-testid': 'give-drops-id' }}
          sx={{ maxWidth: 360 }}
        />
      )}
      <Box>
        <Button
          variant="contained"
          disabled={busy || (needsId && !id.trim())}
          onClick={() => void preview()}
          data-testid="give-drops-start"
          sx={{ borderRadius: radii.pill }}
        >
          {t('skins.admin.drops.start')}
        </Button>
      </Box>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        PaperProps={{
          sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
        }}
        data-testid="give-drops-confirm"
      >
        {confirm && (
          <>
            <DialogTitle sx={{ fontFamily: fontDisplay }}>{who(confirm.count)}</DialogTitle>
            <DialogContent>
              <Typography sx={{ color: color.ink2, fontSize: '0.875rem' }}>
                {confirm.count === 0
                  ? t('skins.admin.drops.nobody')
                  : confirm.names.slice(0, 20).join(', ') +
                    (confirm.names.length > 20 ? ` +${confirm.names.length - 20}` : '')}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>{t('skins.admin.drops.cancel')}</Button>
              <Button
                variant="contained"
                disabled={busy || confirm.count === 0}
                onClick={() => void give()}
                data-testid="give-drops-give"
                sx={{ borderRadius: radii.pill }}
              >
                {t('skins.admin.drops.give', { count: confirm.count })}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
