/**
 * Joining a shuffle tournament on your own: no team, the platform draws them each round. The
 * overview shows who is in and a Join (or Leave) button while sign-up is open; a visitor who
 * is not signed in is sent to sign in first.
 */
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { ShuffleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { paths } from '../../../paths';
import { fontDisplay, radii, tokens } from '../../../theme/tokens';
import type { ShufflePlayer } from '../../../hooks/useTournamentSignup';
import { Face } from './PlayerFace';

const { color } = tokens;

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
  /** The tournament has started: no joining or leaving. */
  started: boolean;
  /** How many players it takes, when capped. */
  spots: number | null;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [busy, setBusy] = useState(false);
  const joined = !!steamId && players.some((p) => p.steamId === steamId);
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
            {joined ? t('shuffleJoin.youreIn') : t('shuffleJoin.title')}
          </Typography>
          <Typography sx={{ color: 'text.secondary' }}>
            {joined ? t('shuffleJoin.inBody') : t('shuffleJoin.body')}
          </Typography>
        </Box>
        {!started &&
          (!steamId ? (
            open && (
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
          ) : joined ? (
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
          ) : (
            open && (
              <Button
                variant="contained"
                disabled={busy || full}
                onClick={() => void act(true)}
                data-testid="shuffle-join-button"
                sx={{ borderRadius: radii.pill, px: 3.25, py: 1.75, fontWeight: 600 }}
              >
                {full ? t('shuffleJoin.full') : t('shuffleJoin.join')}
              </Button>
            )
          ))}
      </Box>
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
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
