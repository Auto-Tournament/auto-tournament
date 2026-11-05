/**
 * Check in for this match (Claude Design, Match room › Before the match), when
 * the tournament checks in before each match: from the veto opening until the
 * start. Starters say they're here or a captain does it; subs are already
 * ready. A starter who didn't check in is swapped for a sub at the start.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fmtCountdown, fmtTime } from '../../utils/time';
import { fontDisplay, mono, radii, tokens, withAlpha } from '../../theme/tokens';

const { color } = tokens;

interface State {
  open: boolean;
  closesAt: number | null;
  teams: Array<{
    teamId: string;
    name: string;
    players: Array<{ steamId: string; name: string; role: 'starter' | 'sub'; checkedIn: boolean }>;
  }>;
}

export function MatchCheckInPanel({
  matchSlug,
  teamId,
}: {
  matchSlug: string;
  teamId: string | null;
}) {
  const { t } = useTranslation();
  const { playerSteamId } = useAuth();
  const { showError } = useSnackbar();
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api
      .get<{ state: State | null }>(`/api/match-check-in/${encodeURIComponent(matchSlug)}`)
      .catch(() => null);
    setState(r?.state ?? null);
  }, [matchSlug]);
  useEffect(() => {
    void load();
    // shortcut: polls every 15 s; move to the match socket if this page gets busy.
    const poll = window.setInterval(() => void load(), 15_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);
  if (!state?.open) return null;

  const post = async (path: string) => {
    setBusy(true);
    try {
      await api.post(`/api/match-check-in/${encodeURIComponent(matchSlug)}${path}`, {});
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stateLabel = (p: { role: string; checkedIn: boolean }) => {
    if (p.role === 'sub') return t('matchCheckIn.ready');
    return p.checkedIn ? t('matchCheckIn.checkedIn') : t('matchCheckIn.notYet');
  };
  const me = state.teams.flatMap((tm) => tm.players).find((p) => p.steamId === playerSteamId);
  const closes = state.closesAt ? state.closesAt * 1000 : null;

  return (
    <Box
      component="section"
      aria-labelledby="match-checkin-title"
      data-testid="match-checkin"
      sx={{
        borderRadius: '20px',
        border: `2px solid ${color.live}`,
        bgcolor: color.paper2,
        p: { xs: 2.5, sm: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, maxWidth: 620 }}>
          <Typography
            sx={{
              ...mono,
              fontSize: 12,
              letterSpacing: 1.5,
              color: color.live,
              textTransform: 'uppercase',
            }}
          >
            {closes
              ? t('matchCheckIn.eyebrow', { time: fmtTime(closes) })
              : t('matchCheckIn.eyebrowNoTime')}
          </Typography>
          <Typography
            id="match-checkin-title"
            component="h2"
            sx={{ fontFamily: fontDisplay, fontSize: 28, fontWeight: 700 }}
          >
            {t('matchCheckIn.title')}
          </Typography>
          <Typography sx={{ color: color.ink2, lineHeight: 1.5 }}>
            {t('matchCheckIn.body')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1.25 }}>
          {closes && (
            <Box
              sx={{
                borderRadius: '14px',
                bgcolor: color.paper3,
                px: 2,
                py: 1.25,
                textAlign: 'right',
              }}
            >
              <Typography sx={{ fontSize: 12, color: color.ink2 }}>
                {t('matchCheckIn.closesIn')}
              </Typography>
              <Typography sx={{ ...mono, fontSize: 26, fontWeight: 600 }}>
                {fmtCountdown(closes, now)}
              </Typography>
            </Box>
          )}
          {me && !me.checkedIn && (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void post('')}
              data-testid="match-checkin-here"
              sx={{
                minHeight: 52,
                px: 3.25,
                borderRadius: radii.pill,
                fontWeight: 700,
                bgcolor: color.live,
                color: color.accentInk,
              }}
            >
              {t('signup.checkIn.imHere')}
            </Button>
          )}
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.75,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
        }}
      >
        {state.teams.map((tm) => {
          const starters = tm.players.filter((p) => p.role === 'starter');
          const inCount = starters.filter((p) => p.checkedIn).length;
          const mine = tm.teamId === teamId;
          return (
            <Box
              key={tm.teamId}
              sx={{
                borderRadius: '14px',
                bgcolor: color.paper3,
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 1.25,
                  alignItems: 'baseline',
                }}
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {mine ? t('matchCheckIn.yourTeam', { team: tm.name }) : tm.name}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 13,
                    color: inCount === starters.length ? color.live : color.warning,
                  }}
                >
                  {t('matchCheckIn.count', { in: inCount, total: starters.length })}
                </Typography>
              </Box>
              {tm.players.map((p) => (
                <Box
                  key={p.steamId}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    minHeight: 36,
                    fontSize: 14,
                  }}
                >
                  <Box
                    component="span"
                    aria-hidden
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '999px',
                      bgcolor: p.checkedIn ? color.live : color.rule,
                    }}
                  />
                  <Box component="span" sx={{ flex: 1 }}>
                    {p.name}
                    <Box component="span" sx={{ ml: 1, ...mono, fontSize: 11, color: color.muted }}>
                      {p.role === 'sub' ? t('matchCheckIn.sub') : t('matchCheckIn.starter')}
                    </Box>
                  </Box>
                  <Typography
                    component="span"
                    sx={{ fontSize: 13, color: p.checkedIn ? color.live : color.ink2 }}
                  >
                    {stateLabel(p)}
                  </Typography>
                  {mine && !p.checkedIn && p.steamId !== playerSteamId && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      aria-label={t('signup.checkIn.checkInFor', { name: p.name })}
                      onClick={() =>
                        void post(
                          `/${encodeURIComponent(tm.teamId)}/${encodeURIComponent(p.steamId)}`
                        )
                      }
                      sx={{ borderRadius: radii.pill, minWidth: 0 }}
                    >
                      {t('signup.checkIn.checkInShort')}
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 1.25,
          alignItems: 'flex-start',
          borderRadius: '12px',
          bgcolor: withAlpha(color.warning, 0.08),
          border: `1px solid ${withAlpha(color.warning, 0.45)}`,
          px: 1.75,
          py: 1.5,
          fontSize: 14,
        }}
      >
        <WarningIcon size={18} color={color.warning} aria-hidden style={{ flex: 'none' }} />
        <span>{t('matchCheckIn.rule')}</span>
      </Box>
    </Box>
  );
}
