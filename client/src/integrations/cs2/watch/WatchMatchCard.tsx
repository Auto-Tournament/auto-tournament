/**
 * "Watch match" for spectators (the 3.0 draft's Spectator board): the match's
 * GOTV in CS2, `delay` seconds behind the players. Its states: live (the
 * button, the seats), before the map (not yet), off (GOTV off or not for
 * this viewer), and nothing for a player in the match. An admin can mark it
 * as the stage match (every seat, for the casters and the stream).
 * From GET /api/events/watch/:slug (api cs2 gotv.ts).
 */
import { useEffect, useState } from 'react';
import { Box, Button, Switch, Typography } from '@mui/material';
import { EyeIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  useAuth,
  useModuleTranslation,
  useSnackbar,
  mono,
  radii,
  tokens,
  panelSx,
} from '../../../module-sdk';

const { color } = tokens;

interface WatchAnswer {
  state: 'live' | 'before' | 'off' | 'player' | 'none';
  delay: number;
  seats: number;
  connect?: string;
  steamUrl?: string;
  onStage?: boolean;
  reason?: string;
}

export function WatchMatchCard({ matchSlug }: { matchSlug: string }) {
  const { t } = useModuleTranslation('cs2');
  const { isAuthenticated: isAdmin } = useAuth();
  const { showError, showSuccess } = useSnackbar();
  const [watch, setWatch] = useState<WatchAnswer | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get<{ success: boolean } & WatchAnswer>(
          `/api/events/watch/${encodeURIComponent(matchSlug)}`
        )
        .then((res) => live && setWatch(res))
        .catch(() => live && setWatch(null));
    void load();
    // The map going live opens it: look again now and then.
    const id = window.setInterval(load, 15_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [matchSlug, version]);

  if (!watch || watch.state === 'player' || watch.state === 'none') return null;

  const copy = async () => {
    if (!watch.connect) return;
    try {
      await navigator.clipboard.writeText(watch.connect);
      showSuccess(t('watch.copied'));
    } catch {
      showError(t('watch.copyFailed'));
    }
  };
  const setStage = async (onStage: boolean) => {
    try {
      await api.put(`/api/matches/${encodeURIComponent(matchSlug)}/on-stage`, { onStage });
      setVersion((v) => v + 1);
    } catch (error) {
      showError(apiErrorMessage(error, t('watch.stageFailed')));
    }
  };

  const live = watch.state === 'live';
  const text =
    watch.state === 'live'
      ? watch.delay > 0
        ? t('watch.liveText', { count: watch.delay, seats: watch.seats })
        : t('watch.liveTextNoDelay', { seats: watch.seats })
      : watch.state === 'before'
        ? t('watch.beforeText')
        : watch.reason === 'signed_in'
          ? t('watch.offSignIn')
          : watch.reason === 'admins'
            ? t('watch.offAdmins')
            : watch.reason === 'no_port'
              ? t('watch.offNoPort')
              : t('watch.offText');

  return (
    <Box
      component="section"
      aria-labelledby="watch-match"
      data-testid="watch-match"
      data-state={watch.state}
      sx={{
        ...panelSx,
        p: { xs: 2, sm: 3 },
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        border: `2px solid ${live ? color.live : color.rule}`,
      }}
    >
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: '1 1 320px', minWidth: 0 }}
      >
        <Typography
          id="watch-match"
          component="h2"
          sx={{ m: 0, fontWeight: 700, fontSize: '1.125rem' }}
        >
          {t('watch.title')}
        </Typography>
        <Typography sx={{ color: color.ink2 }}>{text}</Typography>
        {live && watch.connect && (
          <Box
            component="button"
            type="button"
            onClick={() => void copy()}
            data-testid="watch-connect"
            sx={{
              all: 'unset',
              cursor: 'pointer',
              alignSelf: 'flex-start',
              ...mono,
              fontSize: '0.8125rem',
              px: 1.5,
              py: 0.75,
              borderRadius: radii.sm,
              bgcolor: color.paper3,
              color: color.ink2,
              '&:focus-visible': { outline: `2px solid ${color.focus}` },
            }}
            aria-label={t('watch.copyLabel')}
          >
            {watch.connect}
          </Box>
        )}
        {isAdmin && (
          <Box
            component="label"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: color.ink2,
            }}
          >
            <Switch
              size="small"
              checked={watch.onStage === true}
              onChange={(e) => void setStage(e.target.checked)}
              slotProps={{ input: { 'data-testid': 'watch-on-stage' } as Record<string, string> }}
            />
            {t('watch.onStage')}
          </Box>
        )}
      </Box>
      {live && watch.steamUrl ? (
        <Button
          component="a"
          href={watch.steamUrl}
          variant="contained"
          startIcon={<EyeIcon size={18} aria-hidden />}
          data-testid="watch-button"
          sx={{ minHeight: 48, borderRadius: radii.pill, fontWeight: 700 }}
        >
          {t('watch.button')}
        </Button>
      ) : (
        <Button
          variant="outlined"
          disabled
          startIcon={<EyeIcon size={18} aria-hidden />}
          sx={{ minHeight: 48, borderRadius: radii.pill }}
        >
          {watch.state === 'before' ? t('watch.buttonBefore') : t('watch.buttonOff')}
        </Button>
      )}
    </Box>
  );
}
