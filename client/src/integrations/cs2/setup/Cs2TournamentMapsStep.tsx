import { useEffect, useState } from 'react';
import type { TournamentContentStepProps } from '../../types';
import { MapPoolStep } from './MapPoolStep';
import SaveMapPoolModal from '../maps/SaveMapPoolModal';
import { cs2Patch, cs2SettingsOf, withMaps } from './cs2TournamentSettings';
import { defaultMapPool, useCs2MapData } from './useCs2MapData';

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

  return (
    <>
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
