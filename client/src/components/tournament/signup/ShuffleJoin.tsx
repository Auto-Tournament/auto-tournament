/**
 * Joining a shuffle tournament on your own: no team, the platform draws them each round. The
 * overview shows who is in and a Join (or Leave) button while sign-up is open; a visitor who
 * is not signed in is sent to sign in first.
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { ShuffleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { matchPagePath, paths } from '../../../paths';
import { fontDisplay, radii, tokens } from '../../../theme/tokens';
import type { ShufflePlayer } from '../../../hooks/useTournamentSignup';
import { Face } from './PlayerFace';

const { color } = tokens;

interface ShuffleRound {
  round: number | null;
  matches: Array<{
    slug: string;
    status: string;
    teams: Array<{ name: string | null; steamIds: string[] }>;
  }>;
  sittingOut: string[];
}

/** The running round: who plays where, who sits out (polled while the tournament runs). */
function useShuffleRound(tournamentId: number, started: boolean): ShuffleRound | null {
  const [round, setRound] = useState<ShuffleRound | null>(null);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const load = () =>
      api
        .get<ShuffleRound>(`/api/tournament/${tournamentId}/shuffle-round`)
        .then((r) => !cancelled && setRound(r))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tournamentId, started]);
  return round;
}

export function ShuffleJoin({
  tournamentId,
  players,
  steamId,
  open,
  started,
  spots,
  onChange,
}: {
  tournamentId: number;
  players: ShufflePlayer[];
  /** The signed-in player; null for a visitor. */
  steamId: string | null;
  /** Sign-up is open now. */
  open: boolean;
  /** The tournament has started: no leaving; joining puts you in the next round's draw. */
  started: boolean;
  /** How many players it takes, when capped. */
  spots: number | null;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [busy, setBusy] = useState(false);
  const joined = !!steamId && players.some((p) => p.steamId === steamId);
  const round = useShuffleRound(tournamentId, started);
  const roundNo = round?.round ?? null;
  const myMatch =
    steamId && round
      ? (round.matches.find((m) => m.teams.some((team) => team.steamIds.includes(steamId))) ?? null)
      : null;
  const myTeam = myMatch?.teams.find((team) => !!steamId && team.steamIds.includes(steamId));
  const sittingOut = new Set(round?.sittingOut ?? []);
  const nameOf = new Map(players.map((p) => [p.steamId, p.name]));
  const names = (ids: string[]) => ids.map((id) => nameOf.get(id) ?? id).join(' + ');
  const iSitOut = !!steamId && joined && roundNo !== null && sittingOut.has(steamId);
  const title =
    joined && roundNo !== null && myMatch
      ? t('shuffleJoin.playingTitle', { round: roundNo })
      : iSitOut
        ? t('shuffleJoin.sittingOutTitle', { round: roundNo })
        : joined
          ? t('shuffleJoin.youreIn')
          : t('shuffleJoin.title');
  const body =
    joined && myMatch
      ? t('shuffleJoin.playingBody', { team: myTeam?.name ?? '' })
      : iSitOut
        ? t('shuffleJoin.sittingOutBody', { next: (roundNo ?? 0) + 1 })
        : joined
          ? t('shuffleJoin.inBody')
          : t('shuffleJoin.body');
  const full = spots !== null && players.length >= spots && !joined;

  const act = async (join: boolean) => {
    setBusy(true);
    try {
      if (join) await api.post(`/api/tournament-signup/${tournamentId}/join`, {});
      else await api.delete(`/api/tournament-signup/${tournamentId}/join`);
      await onChange();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="section"
      aria-labelledby="shuffle-join-title"
      data-testid="shuffle-join"
      sx={{
        p: { xs: 2.5, md: 3 },
        borderRadius: radii.lg,
        bgcolor: 'background.surface2',
        border: 1,
        borderColor: joined ? color.accent : 'divider',
        display: 'grid',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <ShuffleIcon size={28} weight="duotone" color={color.accent} aria-hidden />
        <Box sx={{ flex: '1 1 16rem', minWidth: 0 }}>
          <Typography
            id="shuffle-join-title"
            component="h2"
            sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.35rem' }}
          >
            {title}
          </Typography>
          <Typography sx={{ color: 'text.secondary' }} data-testid="shuffle-round-state">
            {body}
          </Typography>
        </Box>
        {myMatch && (
          <Button
            component={RouterLink}
            to={matchPagePath(myMatch.slug)}
            variant="contained"
            data-testid="shuffle-my-match"
            sx={{ borderRadius: radii.pill, px: 3.25, py: 1.75, fontWeight: 600 }}
          >
            {t('shuffleJoin.goToMatch')}
          </Button>
        )}
        {!steamId
          ? open && (
              <Button
                component={RouterLink}
                to={paths.login}
                variant="contained"
                data-testid="shuffle-join-sign-in"
                sx={{ borderRadius: radii.pill, px: 3, py: 1.5, fontWeight: 600 }}
              >
                {t('shuffleJoin.signInToJoin')}
              </Button>
            )
          : joined
            ? !started && (
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={busy}
                  onClick={() => void act(false)}
                  data-testid="shuffle-leave"
                  sx={{ borderRadius: radii.pill, px: 3, py: 1.5 }}
                >
                  {t('shuffleJoin.leave')}
                </Button>
              )
            : open && (
                <Button
                  variant="contained"
                  disabled={busy || full}
                  onClick={() => void act(true)}
                  data-testid="shuffle-join-button"
                  sx={{ borderRadius: radii.pill, px: 3.25, py: 1.75, fontWeight: 600 }}
                >
                  {full ? t('shuffleJoin.full') : t('shuffleJoin.join')}
                </Button>
              )}
      </Box>
      {round && roundNo !== null && round.matches.length > 0 && (
        <Box data-testid="shuffle-round" sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
            {t('shuffleJoin.roundHeading', { round: roundNo })}
          </Typography>
          {round.matches.map((m) => (
            <Box
              key={m.slug}
              component={RouterLink}
              to={matchPagePath(m.slug)}
              data-testid="shuffle-round-match"
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
                p: 1.5,
                borderRadius: radii.md,
                border: 1,
                borderColor: m.slug === myMatch?.slug ? color.accent : 'divider',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <Typography sx={{ fontWeight: 600, minWidth: 0 }}>
                {names(m.teams[0]?.steamIds ?? [])}
              </Typography>
              <Typography component="span" sx={{ color: 'text.secondary' }}>
                {t('shuffleJoin.versus')}
              </Typography>
              <Typography sx={{ fontWeight: 600, minWidth: 0 }}>
                {names(m.teams[1]?.steamIds ?? [])}
              </Typography>
              <Typography
                component="span"
                sx={{ ml: 'auto', fontSize: '0.75rem', color: 'text.secondary' }}
              >
                {t(
                  `shuffleJoin.status.${m.status === 'live' ? 'live' : m.status === 'completed' ? 'done' : 'waiting'}`
                )}
              </Typography>
            </Box>
          ))}
          {round.sittingOut.length > 0 && (
            <Typography sx={{ color: 'text.secondary' }} data-testid="shuffle-round-sitting-out">
              {t('shuffleJoin.sittingOutList', { names: names(round.sittingOut) })}
            </Typography>
          )}
        </Box>
      )}
      <Box>
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
          {spots !== null
            ? t('shuffleJoin.countOf', { count: players.length, spots })
            : t('shuffleJoin.count', { count: players.length })}
        </Typography>
        {players.length > 0 && (
          <Box
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}
            data-testid="shuffle-players"
          >
            {players.map((p) => (
              <Box
                key={p.steamId}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
              >
                <Face name={p.name} avatar={p.avatar} size={32} />
                <Typography
                  sx={{
                    fontWeight: p.steamId === steamId ? 700 : 500,
                    maxWidth: '12rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </Typography>
                {roundNo !== null && (
                  <Typography
                    component="span"
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: sittingOut.has(p.steamId) ? color.muted : color.accent,
                    }}
                  >
                    {sittingOut.has(p.steamId)
                      ? t('shuffleJoin.tagSittingOut')
                      : t('shuffleJoin.tagPlaying')}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
