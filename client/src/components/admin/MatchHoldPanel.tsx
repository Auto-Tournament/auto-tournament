/**
 * Hold a match instead of letting the automation hand out a walkover (the
 * API's services/matchHolds.ts): delay it some minutes or hold it until
 * released. While held it is not loaded or auto-started and the server's
 * walkover clock is off; when it goes ahead both start afresh. "Restart the
 * countdown" gives the teams the full time again without holding.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { ArrowCounterClockwiseIcon, HourglassMediumIcon, PlayIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

interface HoldState {
  heldUntil: number | null;
  reason: string | null;
  tournamentPaused: boolean;
}

/** held_until for a hold with no end (the API's HOLD_FOREVER). */
const HOLD_FOREVER = 2147483647;
const DELAYS = [5, 15, 30];

export function MatchHoldPanel({
  matchSlug,
  matchStatus,
  onSuccess,
  onError,
}: {
  matchSlug: string;
  matchStatus?: string;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [hold, setHold] = useState<HoldState | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ hold: HoldState }>(
        `/api/matches/${encodeURIComponent(matchSlug)}/hold`
      );
      setHold(res.hold);
    } catch {
      setHold(null);
    }
  }, [matchSlug]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      onSuccess?.(done);
      await load();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : t('adminMatchControls.hold.failed'));
    } finally {
      setBusy(false);
    }
  };

  const holdFor = (minutes: number | null) =>
    run(
      () =>
        api.post(`/api/matches/${encodeURIComponent(matchSlug)}/hold`, {
          minutes,
          reason: reason.trim() || undefined,
        }),
      minutes === null
        ? t('adminMatchControls.hold.heldDone')
        : t('adminMatchControls.hold.delayedDone', { minutes })
    );

  if (matchStatus === 'completed' || matchStatus === 'cancelled' || matchStatus === 'live') {
    return null;
  }

  const held = !!hold?.heldUntil;
  const until =
    hold?.heldUntil && hold.heldUntil !== HOLD_FOREVER
      ? new Date(hold.heldUntil * 1000).toLocaleTimeString(i18n.language, {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <Box data-testid="match-hold-panel">
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        {t('adminMatchControls.hold.title')}
      </Typography>
      {held && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="match-hold-status">
          {hold?.tournamentPaused
            ? t('adminMatchControls.hold.tournamentPaused')
            : until
              ? t('adminMatchControls.hold.heldUntil', { time: until })
              : t('adminMatchControls.hold.heldIndefinitely')}
          {hold?.reason ? ` · ${hold.reason}` : ''}
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: '65ch' }}>
        {t('adminMatchControls.hold.description')}
      </Typography>
      {!hold?.tournamentPaused && (
        <Stack spacing={1.5}>
          <TextField
            size="small"
            label={t('adminMatchControls.hold.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            inputProps={{ maxLength: 200, 'data-testid': 'match-hold-reason' }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {DELAYS.map((m) => (
              <Button
                key={m}
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<HourglassMediumIcon />}
                disabled={busy}
                onClick={() => void holdFor(m)}
                data-testid={`match-hold-${m}`}
              >
                {t('adminMatchControls.hold.delay', { minutes: m })}
              </Button>
            ))}
            <Button
              size="small"
              variant="contained"
              color="warning"
              disabled={busy}
              onClick={() => void holdFor(null)}
              data-testid="match-hold-indefinite"
            >
              {t('adminMatchControls.hold.holdUntilReleased')}
            </Button>
            {held && (
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayIcon />}
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.delete(`/api/matches/${encodeURIComponent(matchSlug)}/hold`),
                    t('adminMatchControls.hold.releasedDone')
                  )
                }
                data-testid="match-hold-release"
              >
                {t('adminMatchControls.hold.release')}
              </Button>
            )}
            {!held && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowCounterClockwiseIcon />}
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api.post(
                        `/api/matches/${encodeURIComponent(matchSlug)}/restart-countdown`,
                        {}
                      ),
                    t('adminMatchControls.hold.restartedDone')
                  )
                }
                data-testid="match-hold-restart-countdown"
              >
                {t('adminMatchControls.hold.restartCountdown')}
              </Button>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  );
}
