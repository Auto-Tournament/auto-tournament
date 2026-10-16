import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useModuleTranslation, SwitchRow } from '../../../module-sdk';
import type { TournamentContentStepProps } from '../../types';
import { MapPoolStep } from './MapPoolStep';
import SaveMapPoolModal from '../maps/SaveMapPoolModal';
import { CS2_DEFAULTS, cs2Patch, cs2SettingsOf, withMaps } from './cs2TournamentSettings';
import { defaultMapPool, useCs2MapData } from './useCs2MapData';
import { fitsMapMode } from '../maps/mapModes';

/**
 * The tournament setup's "Maps and veto" step for CS2: the map pool, stored
 * as CS2's own settings (`settings.cs2.maps`, `mapPoolId`, and for shuffle
 * `mapSequence`). It loads the pools and the map catalogue itself; the core
 * wizard only hands over the settings object.
 *
 * A tournament whose maps nobody has picked yet (a new one) gets the pool
 * the step shows by default, as soon as the pools have loaded.
 */
export function Cs2TournamentMapsStep({
  settings,
  onChange,
  type,
  format,
  disabled = false,
}: TournamentContentStepProps) {
  const { t } = useModuleTranslation('cs2');
  const { mapPools, availableMaps, loading, reloadPools } = useCs2MapData();
  const [saveOpen, setSaveOpen] = useState(false);
  const cs2 = cs2SettingsOf(settings);
  const selectedMapPool = defaultMapPool(mapPools, type, cs2.maps, cs2.mapPoolId);

  const setMaps = (maps: string[], mapPoolId: number | null | undefined) =>
    onChange(cs2Patch(withMaps(cs2, maps, type, mapPoolId)));

  // Nothing picked yet: take the pool the picker shows.
  const unpicked = cs2.maps.length === 0 && cs2.mapPoolId === undefined;
  useEffect(() => {
    if (!unpicked || disabled || selectedMapPool === '' || selectedMapPool === 'custom') return;
    const pool = mapPools.find((p) => p.id.toString() === selectedMapPool);
    if (pool) setMaps(pool.mapIds, pool.id);
    // Once per pick: `setMaps` changes every render, the pick does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpicked, disabled, selectedMapPool, mapPools]);

  const handleMapPoolChange = (poolId: string) => {
    if (poolId === 'custom') {
      setMaps([], null);
      return;
    }
    const pool = mapPools.find((p) => p.id.toString() === poolId);
    if (pool) setMaps(pool.mapIds, pool.id);
  };

  // Wingman, set up in one go: CS2's wingman maps, no veto (each match draws
  // its map), wingman's 16 rounds unless the organiser already picked a round
  // count (it overwrote MR6 with 16, 2026-10-15). Wingman is 2v2: the match
  // fills or plays two a side whatever the team size says.
  const wingmanPreset = () => {
    const maps = availableMaps.filter((m) => fitsMapMode(m, m.id, 'wingman')).map((m) => m.id);
    onChange(
      cs2Patch({
        ...withMaps(cs2, maps, type, null),
        mapMode: 'wingman',
        veto: false,
        maxRounds: cs2.maxRounds === CS2_DEFAULTS.maxRounds ? 16 : cs2.maxRounds,
      })
    );
  };

  const vetoFormat = type !== 'shuffle' && ['bo1', 'bo3', 'bo5'].includes(format);

  return (
    <>
      {vetoFormat && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }}>
          <SwitchRow
            label={t('tournament.mapVeto.label')}
            checked={cs2.veto !== false}
            disabled={disabled}
            onChange={(_e, checked) => onChange(cs2Patch({ ...cs2, veto: checked }))}
            slotProps={{
              input: {
                'data-testid': 'tournament-map-veto',
              } as InputHTMLAttributes<HTMLInputElement>,
            }}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={disabled}
            onClick={wingmanPreset}
            data-testid="tournament-wingman-preset"
          >
            {t('tournament.wingmanPreset.button')}
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ flexBasis: '100%' }}>
            {cs2.veto === false ? t('tournament.mapVeto.offHelp') : t('tournament.mapVeto.onHelp')}
          </Typography>
        </Box>
      )}
      {/* Shuffle has no veto, but wingman's one-click setup applies all the same (a 2v2
          shuffle on the wingman maps: new teams each round). */}
      {type === 'shuffle' && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={disabled}
            onClick={wingmanPreset}
            data-testid="tournament-wingman-preset"
          >
            {t('tournament.wingmanPreset.button')}
          </Button>
        </Box>
      )}
      <MapPoolStep
        format={format}
        type={type}
        maps={cs2.maps}
        mapPools={mapPools}
        availableMaps={availableMaps}
        selectedMapPool={selectedMapPool}
        loadingMaps={loading}
        canEdit={!disabled}
        saving={false}
        onMapPoolChange={handleMapPoolChange}
        // Editing the list by hand leaves the pool it came from.
        onMapsChange={(maps) => setMaps(maps, selectedMapPool === 'custom' ? null : cs2.mapPoolId)}
        onMapRemove={(mapId) =>
          setMaps(
            cs2.maps.filter((id) => id !== mapId),
            null
          )
        }
        onSaveMapPool={() => setSaveOpen(true)}
        mapMode={cs2.mapMode}
        veto={cs2.veto !== false}
        onMapModeChange={(mode) => {
          // Maps of another type leave; so does the pool, when it had any.
          const kept = cs2.maps.filter((id) =>
            fitsMapMode(
              availableMaps.find((m) => m.id === id),
              id,
              mode
            )
          );
          const next = withMaps(
            cs2,
            kept,
            type,
            kept.length === cs2.maps.length ? cs2.mapPoolId : null
          );
          onChange(cs2Patch({ ...next, mapMode: mode }));
        }}
      />
      <SaveMapPoolModal
        open={saveOpen}
        mapIds={cs2.maps}
        onClose={() => setSaveOpen(false)}
        onSave={() => void reloadPools()}
      />
    </>
  );
}
