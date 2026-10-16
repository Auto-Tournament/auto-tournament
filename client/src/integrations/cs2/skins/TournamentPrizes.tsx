/**
 * "What you can win" on the tournament overview: the skins the top three get (a pick of a
 * rarity, or a set skin) and the drops after each match played, from the site's skin settings,
 * with the notice that none of it is a real CS2 skin. Nothing when skins are off, or this
 * tournament gives none (esports mode, skin rewards off).
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { TrophyIcon } from '@phosphor-icons/react';
import {
  api,
  useModuleTranslation,
  tokens,
  fontDisplay,
  radii,
  withAlpha,
  panelSx,
  panelBorderSx,
} from '../../../module-sdk';
import type { TournamentPrizesViewProps } from '../../types';
import { rarityColor } from './rarity';
import { VirtualNotice } from './SkinParts';
import { skinPaths } from './paths';

const { color } = tokens;
const MEDAL = [color.medalGold, color.medalSilver, color.medalBronze];

interface Odds {
  tournamentMatchDrops: boolean;
  tournamentRewards: Array<{
    place: number;
    mode: 'rarity' | 'random' | 'skin' | 'none' | string;
    rarity: string | null;
    weapon: string | null;
    name: string | null;
  }>;
}

/** A tournament's own prize list (settings.cs2.rewards), or null to use the site's. */
function ownRewards(settings: unknown): Odds['tournamentRewards'] | null {
  const cs2 = ((settings ?? {}) as { cs2?: { rewards?: unknown } }).cs2;
  if (!Array.isArray(cs2?.rewards)) return null;
  return (cs2.rewards as Array<Record<string, unknown>>).map((r) => ({
    place: Number(r.place),
    mode: String(r.mode ?? 'random'),
    rarity: (r.rarity as string | undefined) ?? null,
    weapon: (r.weapon as string | undefined) ?? null,
    name: (r.name as string | undefined) ?? null,
  })) as Odds['tournamentRewards'];
}

/** The tournament's own switches: esports mode and skin rewards off give nothing. */
function rewardsOff(settings: unknown): boolean {
  const s = (settings ?? {}) as { skinRewards?: unknown; cs2?: unknown };
  const cs2 = (s.cs2 ?? {}) as { skinRewards?: unknown; esportsMode?: unknown };
  return cs2.esportsMode === true || cs2.skinRewards === false || s.skinRewards === false;
}

export function TournamentPrizes({ tournament }: TournamentPrizesViewProps) {
  const { t } = useModuleTranslation('cs2');
  const [odds, setOdds] = useState<Odds | null>(null);
  const off = rewardsOff(tournament.settings);

  useEffect(() => {
    if (off) return;
    let live = true;
    api
      .get<{ success: boolean } & Odds>('/api/skins/odds')
      .then((res) => live && setOdds(res))
      .catch(() => live && setOdds(null)); // 404: skins are off
    return () => {
      live = false;
    };
  }, [off]);

  if (off || !odds) return null;
  // The tournament's own prizes when it set them (settings.cs2.rewards), else the site's.
  const own = ownRewards(tournament.settings);
  const order = (place: number) => (place === 0 ? 99 : place);
  const places = [...(own ?? odds.tournamentRewards)]
    .filter((r) => r.mode !== 'none')
    .sort((a, b) => order(a.place) - order(b.place));
  if (places.length === 0 && !odds.tournamentMatchDrops) return null;

  return (
    <Box
      component="section"
      aria-labelledby="prizes-title"
      data-testid="tournament-prizes"
      sx={{
        ...panelSx,
        ...panelBorderSx,
        display: 'grid',
        gap: 1.5,
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TrophyIcon size={20} weight="fill" color={color.medalGold} aria-hidden />
        <Typography
          id="prizes-title"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
        >
          {t('skins.prizes.title')}
        </Typography>
      </Box>
      <Typography sx={{ color: color.ink2, fontSize: '0.875rem' }}>
        {t('skins.prizes.intro')}
      </Typography>
      {places.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
            gap: 1,
          }}
        >
          {places.map((r) => {
            const tone = r.mode !== 'skin' && r.rarity ? rarityColor[r.rarity] : color.accent;
            return (
              <Box
                key={r.place}
                data-testid={`tournament-prize-${r.place}`}
                sx={{
                  display: 'grid',
                  gap: 0.25,
                  p: 1.25,
                  borderRadius: radii.md,
                  bgcolor: withAlpha(tone ?? color.accent, 0.08),
                  borderLeft: `3px solid ${tone ?? color.accent}`,
                }}
              >
                <Typography
                  sx={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: MEDAL[r.place - 1] ?? color.ink2,
                  }}
                >
                  {r.place === 0 ? t('skins.prizes.everyone') : t('skins.place', { n: r.place })}
                </Typography>
                <Typography sx={{ fontSize: '0.9375rem' }}>
                  {r.mode === 'skin' && r.name
                    ? [r.weapon, r.name].filter(Boolean).join(' | ')
                    : t('skins.prizes.pickOne', {
                        rarity: t(`skins.rarity.${r.rarity ?? 'rare'}`),
                      })}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
      {odds.tournamentMatchDrops && (
        <Typography sx={{ color: color.ink2, fontSize: '0.875rem' }}>
          {t('skins.prizes.matchDrops')}{' '}
          <Box
            component={RouterLink}
            to={skinPaths.dropRates}
            sx={{
              color: color.accent,
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {t('skins.drops.link')}
          </Box>
        </Typography>
      )}
      <VirtualNotice compact />
    </Box>
  );
}
