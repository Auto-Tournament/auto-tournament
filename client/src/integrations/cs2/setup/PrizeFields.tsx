/** Skin rewards for the placings in the setup's Match settings step. */
import { Box, MenuItem, TextField } from '@mui/material';
import { SegmentedControl, SwitchRow, useModuleTranslation } from '../../../module-sdk';
import type { Cs2TournamentSettings } from './cs2TournamentSettings';

type Update = (patch: Partial<Cs2TournamentSettings>) => void;

/** Places with a prize: 1st–4th, and 0 for everyone else who played. */
const PRIZE_PLACES = [1, 2, 3, 4, 0];
const PRIZE_RARITIES = ['ancient', 'legendary', 'mythical', 'rare', 'uncommon', 'common'];
/** A custom list starts from the best: 1st the rarest grade with skins, one lower each place. */
const DEFAULT_PRIZES: NonNullable<Cs2TournamentSettings['rewards']> = [
  { place: 1, mode: 'random', rarity: 'ancient' },
  { place: 2, mode: 'random', rarity: 'legendary' },
  { place: 3, mode: 'random', rarity: 'mythical' },
  { place: 4, mode: 'random', rarity: 'rare' },
  { place: 0, mode: 'random', rarity: 'uncommon' },
];

/** Skin rewards for the placings: the site's prizes or the tournament's own. */
export function PrizeFields({
  value,
  update,
  disabled,
}: {
  value: Cs2TournamentSettings;
  update: Update;
  disabled: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  return (
    <>
      <SwitchRow
        label={t('skins.tournamentRewardsSwitch')}
        checked={value.skinRewards !== false}
        onChange={(event) => update({ skinRewards: event.target.checked })}
        disabled={disabled}
      />
      {value.skinRewards !== false && (
        <Box
          sx={{ display: 'grid', gap: 1.5, maxWidth: 520 }}
          data-testid="tournament-prizes-editor"
        >
          <SegmentedControl
            label={t('skins.prizesEditor.label')}
            value={value.rewards ? 'custom' : 'site'}
            onChange={(v: string) => update({ rewards: v === 'custom' ? DEFAULT_PRIZES : null })}
            options={[
              { value: 'site', label: t('skins.prizesEditor.site') },
              { value: 'custom', label: t('skins.prizesEditor.custom') },
            ]}
            disabled={disabled}
          />
          {value.rewards &&
            PRIZE_PLACES.map((place) => {
              const r = value.rewards?.find((x) => x.place === place);
              const current = !r || r.mode === 'none' ? 'none' : (r.rarity ?? 'rare');
              return (
                <TextField
                  key={place}
                  select
                  size="small"
                  label={place === 0 ? t('skins.prizes.everyone') : t('skins.place', { n: place })}
                  value={current}
                  disabled={disabled}
                  data-testid={`tournament-prize-place-${place}`}
                  onChange={(e) => {
                    const next = (value.rewards ?? []).filter((x) => x.place !== place);
                    next.push(
                      e.target.value === 'none'
                        ? { place, mode: 'none' }
                        : { place, mode: 'random', rarity: e.target.value }
                    );
                    update({ rewards: next.sort((a, b) => (a.place || 9) - (b.place || 9)) });
                  }}
                >
                  {PRIZE_RARITIES.map((rarity) => (
                    <MenuItem key={rarity} value={rarity}>
                      {t('skins.prizes.pickOne', { rarity: t(`skins.rarity.${rarity}`) })}
                    </MenuItem>
                  ))}
                  <MenuItem value="none">{t('skins.admin.noReward')}</MenuItem>
                </TextField>
              );
            })}
        </Box>
      )}
    </>
  );
}
