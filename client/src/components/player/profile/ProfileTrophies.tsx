import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { MedalIcon, TrophyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { tournamentTabPath } from '../../../paths';
import { radii, textSize, tokens } from '../../../theme/tokens';

export interface ProfileTrophy {
  tournamentId: number;
  name: string;
  /** 1 to 4. */
  place: number;
  teams: number;
  teamSize: number | null;
  /** Unix seconds. */
  completedAt: number;
}

/**
 * Tournaments the player placed in (from the placement XP each finished
 * tournament pays): winners first in the colour of the place, then the
 * totals. Nothing at all when they have placed nowhere: no empty shelf.
 */
export function ProfileTrophies({ trophies }: { trophies: ProfileTrophy[] }) {
  const { t, i18n } = useTranslation();
  const podium = trophies.filter((tr) => tr.place <= 3);
  if (podium.length === 0) return null;

  const titles = trophies.filter((tr) => tr.place === 1).length;
  const finals = trophies.filter((tr) => tr.place <= 2).length;
  const shown = [...podium]
    .sort((a, b) => a.place - b.place || b.completedAt - a.completedAt)
    .slice(0, 4);
  const colours: Record<number, string> = {
    1: tokens.color.medalGold,
    2: tokens.color.medalSilver,
    3: tokens.color.medalBronze,
  };
  const colour = (place: number) => colours[place] ?? tokens.color.medalBronze;
  const month = (at: number) =>
    new Date(at * 1000).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' });

  return (
    <Box
      component="section"
      aria-labelledby="profile-trophies"
      data-testid="profile-trophies"
      sx={{
        p: 3,
        borderRadius: radii.lg,
        bgcolor: tokens.color.paper2,
        border: `1px solid ${tokens.color.rule}`,
        minWidth: 0,
      }}
    >
      <Typography id="profile-trophies" component="h2" variant="h6" sx={{ fontWeight: 600 }}>
        {t('playerPage.trophies.title')}
      </Typography>
      <Box
        component="ol"
        sx={{
          listStyle: 'none',
          m: 0,
          mt: 2.5,
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2.25,
        }}
      >
        {shown.map((tr) => (
          <Box
            component="li"
            key={tr.tournamentId}
            sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start' }}
          >
            <Box
              sx={{
                flex: 'none',
                width: 40,
                height: 40,
                borderRadius: '12px',
                display: 'grid',
                placeItems: 'center',
                color: colour(tr.place),
                bgcolor: `color-mix(in oklab, ${colour(tr.place)} 16%, ${tokens.color.paper2})`,
              }}
            >
              {tr.place === 1 ? (
                <TrophyIcon size={20} aria-label={t('playerPage.trophies.place1')} />
              ) : (
                <MedalIcon size={20} aria-label={t(`playerPage.trophies.place${tr.place}`)} />
              )}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Box
                component={RouterLink}
                to={tournamentTabPath(tr.tournamentId)}
                sx={{
                  display: 'block',
                  fontWeight: 600,
                  color: 'text.primary',
                  textDecoration: 'none',
                  '&:hover': { color: tokens.color.accent },
                }}
              >
                {tr.name}
              </Box>
              <Typography sx={{ fontSize: textSize.sm, color: 'text.secondary', mt: 0.25 }}>
                {[
                  t(`playerPage.trophies.place${tr.place}`),
                  tr.teams > 0 ? t('playerPage.trophies.teams', { count: tr.teams }) : null,
                  month(tr.completedAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          display: 'flex',
          gap: 2.5,
          flexWrap: 'wrap',
          mt: 2.75,
          pt: 2,
          borderTop: `1px solid ${tokens.color.rule}`,
          fontSize: textSize.sm,
          color: 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>{t('playerPage.trophies.titles', { count: titles })}</span>
        <span>{t('playerPage.trophies.finals', { count: finals })}</span>
        <span>{t('playerPage.trophies.podiums', { count: podium.length })}</span>
      </Box>
    </Box>
  );
}
