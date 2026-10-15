/**
 * On a finished tournament's results: what its top three got, per player,
 * the skin they kept (or "choosing" while their pick is open).
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  api,
  useModuleTranslation,
  tokens,
  fontDisplay,
  radii,
  withAlpha,
} from '../../../module-sdk';
import type { TournamentResultsSectionProps } from '../../types';
import { rarityColor } from './rarity';
import type { Rarity } from './useSkins';
import { skinCardUrl, VirtualNotice } from './SkinParts';

const { color } = tokens;

interface Reward {
  place: number;
  player: { steamId: string; name: string; avatar: string | null };
  skin: { weaponName: string; name: string; rarity: Rarity; imageUrl: string } | null;
  choosing: boolean;
}

const MEDAL = [color.medalGold, color.medalSilver, color.medalBronze];

export function TournamentRewardsSection({ tournamentId }: TournamentResultsSectionProps) {
  const { t } = useModuleTranslation('cs2');
  const [rewards, setRewards] = useState<Reward[] | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ success: boolean; rewards: Reward[] }>(
        `/api/skins/tournaments/${tournamentId}/rewards`
      )
      .then((res) => live && setRewards(res.success ? res.rewards : []))
      .catch(() => live && setRewards([]));
    return () => {
      live = false;
    };
  }, [tournamentId]);

  if (!rewards?.length) return null;
  const places = [...new Set(rewards.map((r) => r.place))].sort();
  return (
    <Box
      component="section"
      aria-labelledby="tournament-rewards"
      sx={{ display: 'grid', gap: 2 }}
      data-testid="tournament-rewards"
    >
      <Typography
        id="tournament-rewards"
        component="h2"
        sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
      >
        {t('skins.rewards.title')}
      </Typography>
      <VirtualNotice compact />
      {places.map((place) => (
        <Box key={place} sx={{ display: 'grid', gap: 1 }}>
          <Typography
            sx={{ fontSize: '0.8125rem', fontWeight: 600, color: MEDAL[place - 1] ?? color.ink2 }}
          >
            {t('skins.place', { n: place })}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
              gap: 1.25,
            }}
          >
            {rewards
              .filter((r) => r.place === place)
              .map((r) => (
                <Box
                  key={`${r.player.steamId}-${r.skin?.name ?? 'choosing'}`}
                  component={RouterLink}
                  to={`/player/${r.player.steamId}/inventory`}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '64px minmax(0,1fr)',
                    gap: 1.25,
                    alignItems: 'center',
                    p: 1.25,
                    borderRadius: radii.md,
                    bgcolor: r.skin ? withAlpha(rarityColor[r.skin.rarity], 0.08) : color.paper2,
                    border: `1px solid ${color.rule}`,
                    color: 'inherit',
                    textDecoration: 'none',
                    '&:hover': { borderColor: color.muted },
                  }}
                >
                  {r.skin ? (
                    <Box
                      component="img"
                      src={skinCardUrl(r.skin.imageUrl)}
                      alt=""
                      sx={{ width: 64, height: 48, objectFit: 'contain' }}
                    />
                  ) : (
                    <Box
                      sx={{ width: 64, height: 48, borderRadius: '8px', bgcolor: color.paper3 }}
                      aria-hidden
                    />
                  )}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{ fontWeight: 600, fontSize: '0.875rem', overflowWrap: 'anywhere' }}
                    >
                      {r.player.name}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: '0.75rem',
                        color: r.skin ? rarityColor[r.skin.rarity] : color.muted,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {r.skin
                        ? `${r.skin.weaponName} | ${r.skin.name}`
                        : t('skins.rewards.choosing')}
                    </Typography>
                  </Box>
                </Box>
              ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
