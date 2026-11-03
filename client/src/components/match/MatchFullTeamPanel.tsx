/**
 * Getting on the server (Claude Design, Match room › Server ready): once the
 * server is ready, each team has the tournament's minutes to have a full team
 * on it, subs included. Then the complete team's captain takes the walkover
 * or plays them short; both short, an admin decides.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fmtCountdown, fmtTime } from '../../utils/time';
import { fontDisplay, mono, radii, tokens, withAlpha } from '../../theme/tokens';

const { color } = tokens;

interface Team {
  side: 'team1' | 'team2';
  teamId: string | null;
  name: string;
  players: Array<{ steamId: string; name: string; sub: boolean; onServer: boolean }>;
  out: string[];
}
interface State {
  deadline: number | null;
  size: number;
  teams: Team[];
  offer: { shortSide: string; expiresAt: number; decided: string | null } | null;
}

function TeamList({ team, size, mine }: { team: Team; size: number; mine: boolean }) {
  const { t } = useTranslation();
  const on = team.players.filter((p) => p.onServer).length;
  const row = (key: string, name: string, role: string, state: string, fg: string, dot: string) => (
    <Box
      key={key}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 36, fontSize: 14 }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 10, height: 10, borderRadius: '999px', bgcolor: dot }}
      />
      <Box component="span" sx={{ flex: 1 }}>
        {name}
        <Box component="span" sx={{ ml: 1, ...mono, fontSize: 11, color: color.muted }}>
          {role}
        </Box>
      </Box>
      <Typography component="span" sx={{ fontSize: 13, color: fg }}>
        {state}
      </Typography>
    </Box>
  );
  return (
    <Box
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
        sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.25, alignItems: 'baseline' }}
      >
        <Typography sx={{ fontWeight: 600 }}>
          {mine ? t('matchCheckIn.yourTeam', { team: team.name }) : team.name}
        </Typography>
        <Typography sx={{ fontSize: 13, color: on >= size ? color.live : color.warning }}>
          {t('matchCheckIn.server.count', { on, size })}
        </Typography>
      </Box>
      {team.players.map((p) => {
        const fg = p.onServer ? color.live : color.warning;
        return row(
          p.steamId,
          p.name,
          p.sub ? t('matchCheckIn.server.subIn') : t('matchCheckIn.starter'),
          p.onServer ? t('matchCheckIn.server.onServer') : t('matchCheckIn.server.joining'),
          fg,
          fg
        );
      })}
      {team.out.map((name) =>
        row(
          `out-${name}`,
          name,
          t('matchCheckIn.server.out'),
          t('matchCheckIn.server.swapped'),
          color.ink2,
          color.rule
        )
      )}
    </Box>
  );
}

export function MatchFullTeamPanel({
  matchSlug,
  teamId,
}: {
  matchSlug: string;
  teamId: string | null;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api
      .get<{ state: State | null }>(
        `/api/match-check-in/${encodeURIComponent(matchSlug)}/full-team`
      )
      .catch(() => null);
    setState(r?.state ?? null);
  }, [matchSlug]);
  useEffect(() => {
    void load();
    // shortcut: polls every 15 s like MatchCheckInPanel; move to the match socket if this page gets busy.
    const poll = window.setInterval(() => void load(), 15_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);
  if (!state || state.offer?.decided) return null;

  const choose = async (take: boolean) => {
    setBusy(true);
    try {
      await api.post(`/api/match-check-in/${encodeURIComponent(matchSlug)}/walkover`, { take });
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mine = state.teams.find((tm) => tm.teamId === teamId);
  const short = state.teams.find((tm) => tm.side === state.offer?.shortSide);
  const canChoose = Boolean(state.offer && short && mine && mine.side !== short.side);
  const deadline = state.deadline ? state.deadline * 1000 : null;

  return (
    <>
      <Box
        component="section"
        aria-labelledby="match-fullteam-title"
        data-testid="match-fullteam"
        sx={{
          borderRadius: '20px',
          border: `2px solid ${color.warning}`,
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
                color: color.warning,
                textTransform: 'uppercase',
              }}
            >
              {deadline
                ? t('matchCheckIn.server.eyebrow', { time: fmtTime(deadline) })
                : t('matchCheckIn.server.eyebrowNoTime')}
            </Typography>
            <Typography
              id="match-fullteam-title"
              component="h2"
              sx={{ fontFamily: fontDisplay, fontSize: 28, fontWeight: 700 }}
            >
              {t('matchCheckIn.server.title')}
            </Typography>
            <Typography sx={{ color: color.ink2, lineHeight: 1.5 }}>
              {mine?.out.length
                ? `${t('matchCheckIn.server.bodyOut', { out: mine.out.join(', ') })} `
                : ''}
              {t('matchCheckIn.server.body', { size: state.size })}
            </Typography>
          </Box>
          {deadline && (
            <Box
              sx={{
                borderRadius: '14px',
                bgcolor: color.paper3,
                px: 2,
                py: 1.25,
                textAlign: 'right',
                alignSelf: 'flex-start',
              }}
            >
              <Typography sx={{ fontSize: 12, color: color.ink2 }}>
                {t('matchCheckIn.server.clockLabel')}
              </Typography>
              <Typography sx={{ ...mono, fontSize: 26, fontWeight: 600 }}>
                {fmtCountdown(deadline, now)}
              </Typography>
            </Box>
          )}
        </Box>
        <Box
          sx={{
            display: 'grid',
            gap: 1.75,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          }}
        >
          {[...state.teams]
            .sort((a, b) => Number(b.teamId === teamId) - Number(a.teamId === teamId))
            .map((tm) => (
              <TeamList key={tm.side} team={tm} size={state.size} mine={tm.teamId === teamId} />
            ))}
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
          <span>{t('matchCheckIn.server.rule')}</span>
        </Box>
      </Box>

      {canChoose && short && (
        <Box
          component="section"
          aria-labelledby="match-walkover-title"
          data-testid="match-walkover"
          sx={{
            borderRadius: '20px',
            border: `1px solid ${color.rule}`,
            bgcolor: color.paper2,
            p: { xs: 2.5, sm: 3 },
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <Typography
            sx={{
              ...mono,
              fontSize: 11,
              letterSpacing: 1.5,
              color: color.muted,
              textTransform: 'uppercase',
            }}
          >
            {t('matchCheckIn.choice.eyebrow', { team: short.name })}
          </Typography>
          <Typography
            id="match-walkover-title"
            component="h2"
            sx={{ fontSize: 20, fontWeight: 600 }}
          >
            {t('matchCheckIn.choice.title', {
              team: short.name,
              on: short.players.filter((p) => p.onServer).length,
              size: state.size,
            })}
          </Typography>
          <Typography sx={{ fontSize: 14, color: color.ink2, lineHeight: 1.5 }}>
            {t('matchCheckIn.choice.body')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void choose(true)}
              sx={{ minHeight: 46, px: 2.5, borderRadius: radii.pill, fontWeight: 600 }}
            >
              {t('matchCheckIn.choice.take')}
            </Button>
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void choose(false)}
              sx={{ minHeight: 46, px: 2.5, borderRadius: radii.pill }}
            >
              {t('matchCheckIn.choice.play')}
            </Button>
          </Box>
        </Box>
      )}
    </>
  );
}
