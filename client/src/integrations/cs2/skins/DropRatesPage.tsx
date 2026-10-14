/**
 * How skin drops work (`/inventory/drops`): when a drop happens, the chance
 * per mode, and the odds of each rarity and of one exact skin. Open to
 * everyone while skins are on.
 */
import { useEffect } from 'react';
import { Box, CircularProgress, Container, Typography } from '@mui/material';
import {
  pageTitle,
  useModuleTranslation,
  tokens,
  fontDisplay,
  radii,
  withAlpha,
} from '../../../module-sdk';
import { rarityColor } from './rarity';
import { formatOdds, useDropOdds } from './odds';

const { color } = tokens;
const mono = { fontVariantNumeric: 'tabular-nums' } as const;

export function DropRatesPage() {
  const { t } = useModuleTranslation('cs2');
  const { odds, loaded } = useDropOdds();

  useEffect(() => {
    document.title = pageTitle(t('skins.drops.title'));
  }, [t]);

  const when = odds
    ? [
        odds.matchmakingDrops && t('skins.drops.whenMatchmaking'),
        odds.tournamentMatchDrops && t('skins.drops.whenTournament'),
        odds.levelUpDrops && t('skins.drops.whenLevel'),
        odds.tournamentRewards.length > 0 && t('skins.drops.whenPlacement'),
      ].filter((line): line is string => Boolean(line))
    : [];
  // Rarest first, like the inventory; a rarity that never drops is left out.
  const rarities = odds ? [...odds.rarities].reverse().filter((r) => r.chance > 0) : [];

  return (
    <Box data-testid="drop-rates-page">
      <Container
        maxWidth="md"
        sx={{ py: { xs: 4, md: 6 }, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <Box>
          <Typography
            component="h1"
            sx={{
              fontFamily: fontDisplay,
              fontSize: '2.25rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              textWrap: 'balance',
            }}
          >
            {t('skins.drops.title')}
          </Typography>
          <Typography sx={{ color: color.ink2, maxWidth: '65ch' }}>
            {t('skins.drops.intro', { count: odds?.optionsPerDrop ?? 3 })}
          </Typography>
        </Box>

        {!loaded ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress aria-label={t('skins.drops.title')} />
          </Box>
        ) : !odds ? (
          <Typography sx={{ color: color.ink2 }}>{t('skins.off')}</Typography>
        ) : (
          <>
            <Box component="section" aria-labelledby="drops-when" sx={{ display: 'grid', gap: 1 }}>
              <Typography
                id="drops-when"
                component="h2"
                sx={{ fontWeight: 600, fontSize: '1.125rem' }}
              >
                {t('skins.drops.whenTitle')}
              </Typography>
              <Box
                component="ul"
                sx={{ m: 0, pl: 2.5, color: color.ink2, display: 'grid', gap: 0.5 }}
              >
                {when.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </Box>
            </Box>

            {(odds.matchmakingDrops || odds.tournamentMatchDrops) && (
              <Box
                component="section"
                aria-labelledby="drops-chance"
                sx={{ display: 'grid', gap: 1.25 }}
              >
                <Typography
                  id="drops-chance"
                  component="h2"
                  sx={{ fontWeight: 600, fontSize: '1.125rem' }}
                >
                  {t('skins.drops.chanceTitle')}
                </Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <Box
                    component="table"
                    sx={{ borderCollapse: 'collapse', minWidth: 320, width: '100%', ...mono }}
                    data-testid="drop-chances"
                  >
                    <thead>
                      <tr>
                        {[t('skins.drops.mode'), t('skins.admin.win'), t('skins.admin.lose')].map(
                          (h, i) => (
                            <Box
                              key={h}
                              component="th"
                              sx={{
                                textAlign: i ? 'right' : 'left',
                                fontWeight: 500,
                                color: color.muted,
                                fontSize: '0.8125rem',
                                pb: 1,
                              }}
                            >
                              {h}
                            </Box>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(['5v5', '2v2', '1v1'] as const).map((mode) => (
                        <Box
                          component="tr"
                          key={mode}
                          sx={{ borderTop: `1px solid ${color.rule}` }}
                        >
                          <Box component="td" sx={{ py: 1, fontWeight: 600 }}>
                            {mode}
                          </Box>
                          <Box component="td" sx={{ py: 1, textAlign: 'right' }}>
                            {formatOdds(odds.chances[mode].win)}
                          </Box>
                          <Box component="td" sx={{ py: 1, textAlign: 'right' }}>
                            {formatOdds(odds.chances[mode].play)}
                          </Box>
                        </Box>
                      ))}
                    </tbody>
                  </Box>
                </Box>
                <Typography sx={{ fontSize: '0.8125rem', color: color.muted, maxWidth: '65ch' }}>
                  {odds.repeatOpponentCut === false
                    ? t('skins.drops.fairNoRepeat')
                    : t('skins.drops.fair')}
                </Typography>
              </Box>
            )}

            <Box
              component="section"
              aria-labelledby="drops-rarity"
              sx={{ display: 'grid', gap: 1.25 }}
            >
              <Typography
                id="drops-rarity"
                component="h2"
                sx={{ fontWeight: 600, fontSize: '1.125rem' }}
              >
                {t('skins.drops.rarityTitle')}
              </Typography>
              <Box sx={{ display: 'grid', gap: 1 }} data-testid="drop-rarities">
                {rarities.map((r) => {
                  const tone = rarityColor[r.rarity];
                  return (
                    <Box
                      key={r.rarity}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: 'minmax(0,1fr) auto',
                          sm: 'minmax(0,1.2fr) minmax(0,2fr) auto',
                        },
                        alignItems: 'center',
                        gap: { xs: 1, sm: 2 },
                        p: 1.5,
                        borderRadius: radii.md,
                        bgcolor: withAlpha(tone, 0.08),
                        borderLeft: `3px solid ${tone}`,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, color: tone }}>
                          {t(`skins.rarity.${r.rarity}`)}
                        </Typography>
                        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                          {t('skins.drops.skins', { count: r.skins })}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'block' },
                          height: 6,
                          borderRadius: radii.pill,
                          bgcolor: color.paper3,
                          overflow: 'hidden',
                        }}
                        aria-hidden
                      >
                        <Box
                          sx={{ width: `${Math.max(1, r.chance)}%`, height: '100%', bgcolor: tone }}
                        />
                      </Box>
                      <Box sx={{ textAlign: 'right', ...mono }}>
                        <Typography sx={{ fontWeight: 600 }}>{formatOdds(r.chance)}</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>
                          {t('skins.drops.perSkin', { odds: formatOdds(r.perSkin) })}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              <Typography sx={{ fontSize: '0.8125rem', color: color.muted, maxWidth: '65ch' }}>
                {t('skins.drops.rarityNote', { count: odds.optionsPerDrop })}
              </Typography>
            </Box>

            {odds.tournamentRewards.length > 0 && (
              <Box
                component="section"
                aria-labelledby="drops-placements"
                sx={{ display: 'grid', gap: 1 }}
              >
                <Typography
                  id="drops-placements"
                  component="h2"
                  sx={{ fontWeight: 600, fontSize: '1.125rem' }}
                >
                  {t('skins.drops.placementTitle')}
                </Typography>
                <Box
                  component="ul"
                  sx={{ m: 0, pl: 2.5, color: color.ink2, display: 'grid', gap: 0.5 }}
                >
                  {odds.tournamentRewards.map((r) => (
                    <li key={r.place}>
                      {t('skins.place', { n: r.place })}:{' '}
                      {r.mode === 'skin' && r.name
                        ? r.name
                        : t('skins.drops.pickOfRarity', {
                            rarity: t(`skins.rarity.${r.rarity ?? 'rare'}`),
                          })}
                    </li>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Container>
    </Box>
  );
}
