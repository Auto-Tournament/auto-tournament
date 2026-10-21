import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fontDisplay, mono, radii, tokens } from '../../theme/tokens';
import { paths } from '../../paths';
import type { TeamMatchInfo } from '../../types';
import { nextMatchCard, type CardTone } from './nextMatchState';

const { color } = tokens;

const TONE: Record<CardTone, { main: string; wash: string }> = {
  act: { main: color.accent, wash: color.accent },
  live: { main: color.live, wash: alpha(color.live, 0.14) },
  wait: { main: color.warning, wash: alpha(color.warning, 0.12) },
  calm: { main: color.ink2, wash: color.paper3 },
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The home page's "Your next match" card: a status block (where the match is), the teams and
 * where it is played, and one button. When the player has to act (veto, join) the whole card
 * is solid orange; live and waiting tint only the block (nextMatchState.ts decides which).
 */
export function NextMatchCard({
  match,
  teamName,
  where,
}: {
  match: TeamMatchInfo;
  teamName: string;
  where: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const card = nextMatchCard(match, now);
  // A countdown ticks; everything else changes with the match itself.
  useEffect(() => {
    if (!card.countdownTo) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [card.countdownTo]);

  const tone = TONE[card.tone];
  const act = card.tone === 'act';
  const ink = act ? color.accentInk : undefined;
  const fixed =
    'text' in card.big ? card.big.text : t(`home.next.${card.big.key}`, card.big.values);
  const big = card.countdownTo !== undefined ? mmss(Math.max(0, card.countdownTo - now)) : fixed;
  const button = { open: 'openMatch', veto: 'next.goVeto', join: 'next.join' }[card.action];

  return (
    <Box
      component="section"
      aria-labelledby="home-next-match-title"
      data-testid="home-next-match"
      data-tone={card.tone}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '156px minmax(0, 1fr) auto' },
        alignItems: 'stretch',
        borderRadius: radii.lg,
        overflow: 'hidden',
        border: `1px solid ${act || card.tone !== 'calm' ? tone.main : color.rule}`,
        bgcolor: act ? color.accent : color.paper2,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridAutoFlow: { xs: 'column', sm: 'row' },
          justifyContent: { xs: 'space-between', sm: 'start' },
          alignContent: 'center',
          alignItems: 'baseline',
          gap: 0.25,
          px: { xs: 2, sm: 2.5 },
          py: { xs: 1.5, sm: 2.25 },
          bgcolor: act ? undefined : tone.wash,
          borderRight: { sm: `1px solid ${act ? alpha(color.accentInk, 0.25) : color.rule}` },
          borderBottom: {
            xs: `1px solid ${act ? alpha(color.accentInk, 0.25) : color.rule}`,
            sm: 0,
          },
        }}
      >
        <Typography
          sx={{
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: '1.5rem',
            fontVariantNumeric: 'tabular-nums',
            color: ink ?? tone.main,
          }}
        >
          {big}
        </Typography>
        <Typography
          sx={{
            ...mono,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: ink ?? color.ink2,
          }}
        >
          {t(`home.next.${card.small.key}`, card.small.values)}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gap: 0.5,
          alignContent: 'center',
          px: { xs: 2, sm: 2.75 },
          pt: { xs: 1.75, sm: 2.25 },
          pb: { xs: 0.5, sm: 2.25 },
          minWidth: 0,
        }}
      >
        <Typography
          id="home-next-match-title"
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: ink ?? (card.tone === 'calm' ? color.muted : tone.main),
          }}
        >
          {card.label === 'nextMatch' ? t('home.nextMatch') : t(`home.next.label.${card.label}`)}
        </Typography>
        <Typography
          sx={{
            fontFamily: fontDisplay,
            fontSize: '1.375rem',
            fontWeight: 600,
            overflowWrap: 'anywhere',
            color: ink,
          }}
        >
          {teamName} {t('home.vs')} {match.opponent?.name ?? t('home.tbd')}
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: ink ?? color.ink2 }}>{where}</Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          alignContent: 'center',
          px: { xs: 2, sm: 0 },
          pr: { sm: 2.75 },
          pt: { xs: 1.5, sm: 0 },
          pb: { xs: 2, sm: 0 },
        }}
      >
        <Button
          component={RouterLink}
          to={paths.matchNow}
          variant={card.tone === 'calm' ? 'outlined' : 'contained'}
          data-testid="home-open-match"
          sx={
            act
              ? {
                  bgcolor: color.accentInk,
                  color: color.accent,
                  '&:hover': { bgcolor: alpha(color.accentInk, 0.85) },
                }
              : undefined
          }
        >
          {t(`home.${button}`)}
        </Button>
      </Box>
    </Box>
  );
}
