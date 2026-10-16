/**
 * A finished tournament's prizes for the viewer (the 3.0 draft's Results):
 * "Your prize" (pick your skin, or the one you got) and the MVP line, and the
 * short line under What's next once the viewer's team is out or won.
 * From GET /api/skins/tournaments/:id/rewards.
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import {
  api,
  useAuth,
  useModuleTranslation,
  tokens,
  radii,
  fontDisplay,
  PlayerAvatar,
  panelSx,
  fmtNum,
} from '../../../module-sdk';
import { skinPaths } from './paths';

const { color } = tokens;
const MVP_PLACE = 99;

interface Reward {
  place: number;
  player: { steamId: string; name: string; avatar: string | null };
  skin: { weaponName: string; name: string; rarity: string; imageUrl: string } | null;
  choosing: boolean;
}
interface PrizeInfo {
  rewards: Reward[];
  prizes?: {
    places: Array<{
      place: number;
      mode: string;
      rarity: string | null;
      pick: 'choice' | 'one' | null;
    }>;
    mvp: { by: 'commends' | 'rating' | 'admin'; rarity: string; pick: 'choice' | 'one' } | null;
  };
  mvp?: {
    player: { steamId: string; name: string; avatar: string | null };
    teamName: string | null;
    commends: number;
    commendedBy: number;
    kinds: Record<string, number>;
    rating: number | null;
    matches: number;
  } | null;
}

function usePrizeInfo(tournamentId: number): PrizeInfo | null {
  const [info, setInfo] = useState<PrizeInfo | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ success: boolean } & PrizeInfo>(`/api/skins/tournaments/${tournamentId}/rewards`)
      .then((res) => live && setInfo(res))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [tournamentId]);
  return info;
}

/** Your prize, then the MVP: at the top of Results. Nothing for a viewer with no prize and no MVP. */
export function TournamentPrizeCards({ tournamentId }: { tournamentId: number }) {
  const { t } = useModuleTranslation('cs2');
  const { playerSteamId } = useAuth();
  const info = usePrizeInfo(tournamentId);
  if (!info) return null;
  const mine = info.rewards.filter((r) => r.player.steamId === playerSteamId);
  // Still to pick: the Pick row above (PrizePickRow) says it. Here only what they got.
  const placing = mine.find((r) => r.place !== MVP_PLACE && !r.choosing);
  const mvpPrize = mine.find((r) => r.place === MVP_PLACE && !r.choosing);
  const placeLabel = (place: number) =>
    place === 0
      ? t('skins.prizeCard.played')
      : t('skins.prizesManage.placeN', { count: place, ordinal: true });
  const rarityOf = (place: number) =>
    info.prizes?.places.find((p) => p.place === place)?.rarity ?? null;

  const card = (r: Reward, eyebrow: string, rarity: string | null, testId: string) => (
    <Box
      component="section"
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      sx={{
        ...panelSx,
        p: { xs: 2, sm: 3 },
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2.5,
      }}
    >
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 420px', minWidth: 0 }}
      >
        <Typography
          sx={{
            fontSize: '0.8125rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: color.medalGold,
          }}
        >
          {eyebrow}
        </Typography>
        <Typography
          id={`${testId}-title`}
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.625rem', fontWeight: 700 }}
        >
          {r.choosing
            ? t('skins.prizeCard.pickTitle', { rarity: rarity ? t(`skins.rarity.${rarity}`) : '' })
            : r.skin
              ? `${r.skin.weaponName} | ${r.skin.name}`
              : ''}
        </Typography>
        <Typography sx={{ color: color.ink2 }}>
          {r.choosing ? t('skins.prizeCard.pickBody') : t('skins.prizeCard.gotBody')}
        </Typography>
      </Box>
      <Button
        component={RouterLink}
        to={skinPaths.inventory}
        variant="contained"
        size="large"
        data-testid={`${testId}-open`}
      >
        {r.choosing ? t('skins.prizeCard.pick') : t('skins.prizeCard.open')}
      </Button>
    </Box>
  );

  const mvp = info.mvp;
  const kindLine = mvp
    ? Object.entries(mvp.kinds)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${t(`skins.prizeCard.kinds.${k}`, { defaultValue: k })} ${n}`)
        .join(', ')
    : '';
  const mvpWhy =
    mvp && info.prizes?.mvp
      ? info.prizes.mvp.by === 'commends'
        ? t('skins.prizeCard.mvpCommends', {
            count: mvp.commends,
            players: mvp.commendedBy,
            kinds: kindLine,
          })
        : info.prizes.mvp.by === 'rating'
          ? t('skins.prizeCard.mvpRating', {
              rating: fmtNum(mvp.rating, 2),
              matches: mvp.matches,
            })
          : t('skins.prizeCard.mvpAdmin')
      : '';

  return (
    <>
      {placing &&
        card(
          placing,
          placing.place === 0
            ? t('skins.prizeCard.eyebrowPlayed')
            : t('skins.prizeCard.eyebrow', { place: placeLabel(placing.place) }),
          rarityOf(placing.place),
          'results-your-prize'
        )}
      {mvpPrize &&
        card(
          mvpPrize,
          t('skins.prizeCard.eyebrowMvp'),
          info.prizes?.mvp?.rarity ?? null,
          'results-your-mvp-prize'
        )}
      {mvp && info.prizes?.mvp && (
        <Box
          component="section"
          aria-labelledby="results-mvp"
          data-testid="results-mvp"
          sx={{
            borderRadius: radii.md,
            bgcolor: color.paper2,
            p: 2,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <PlayerAvatar
            name={mvp.player.name}
            avatarUrl={mvp.player.avatar ?? undefined}
            size={40}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 260px', minWidth: 0 }}>
            <Typography id="results-mvp" sx={{ fontWeight: 700 }}>
              {t('skins.prizeCard.mvpLine', { name: mvp.player.name })}
              {mvp.teamName ? ` · ${mvp.teamName}` : ''}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
              {mvpWhy}{' '}
              {t(
                info.prizes.mvp.pick === 'one'
                  ? 'skins.prizeCard.mvpWinsOne'
                  : 'skins.prizeCard.mvpWinsPick',
                {
                  rarity: t(`skins.rarity.${info.prizes.mvp.rarity}`),
                }
              )}
            </Typography>
          </Box>
        </Box>
      )}
    </>
  );
}

/** Under What's next once the viewer is out or won: what they got. */
export function PlacementPrizeLine({ tournamentId }: { tournamentId: number }) {
  const { t } = useModuleTranslation('cs2');
  const { playerSteamId } = useAuth();
  const info = usePrizeInfo(tournamentId);
  const mine = info?.rewards.find(
    (r) => r.player.steamId === playerSteamId && r.place !== MVP_PLACE
  );
  // Still to pick: the page's Pick row (PrizePickRow) says it, with the button.
  if (!info || !mine || mine.choosing) return null;
  const rarity =
    mine.skin?.rarity ?? info.prizes?.places.find((p) => p.place === mine.place)?.rarity ?? null;
  return (
    <Box component="span" data-testid="whats-next-prize" sx={{ display: 'block', mt: 0.5 }}>
      {t('skins.prizeCard.lineGot', { rarity: rarity ? t(`skins.rarity.${rarity}`) : '' })}{' '}
      <Box component={RouterLink} to={skinPaths.inventory} sx={{ color: color.accent }}>
        {t('skins.prizeCard.openInventory')}
      </Box>
    </Box>
  );
}
