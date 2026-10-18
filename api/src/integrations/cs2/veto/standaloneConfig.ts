/**
 * A standalone match (round 0, no tournament: a manual match, a matchmaking 5v5) keeps its
 * own config; its veto's picks go into that config's maplist and map_sides. Shared by a
 * player's last click (routes.ts) and the turn timer's (simulation.ts).
 */
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

interface PickedMap {
  mapName: string;
  mapNumber?: number;
  sideTeam1?: string;
}

export async function storeStandaloneVetoConfig(
  matchSlug: string,
  rawConfig: string | null | undefined,
  pickedMaps: PickedMap[],
  format: 'bo1' | 'bo3' | 'bo5'
): Promise<void> {
  try {
    const existingConfig = rawConfig ? JSON.parse(rawConfig) : {};
    const ordered = [...pickedMaps].sort((a, b) => (a.mapNumber || 0) - (b.mapNumber || 0));
    const numMaps = format === 'bo1' ? 1 : format === 'bo3' ? 3 : 5;
    const updatedConfig = {
      ...existingConfig,
      maplist: ordered
        .map((m) => m.mapName)
        .filter((name): name is string => Boolean(name))
        .slice(0, numMaps),
      map_sides: ordered.slice(0, numMaps).map((p) => {
        if (p.sideTeam1 === 'CT') return 'team1_ct';
        if (p.sideTeam1 === 'T') return 'team2_ct';
        return 'knife';
      }),
    };
    await db.updateAsync('matches', { config: JSON.stringify(updatedConfig) }, 'slug = ?', [
      matchSlug,
    ]);
    // A matchmaking lobby shows its map too: write the veto's pick back to it.
    if (updatedConfig.maplist[0]) {
      await db.runAsync('UPDATE mm_lobbies SET map = ? WHERE match_slug = ? AND map IS NULL', [
        updatedConfig.maplist[0],
        matchSlug,
      ]);
    }
    log.success(`Updated config maplist for standalone match ${matchSlug} after veto completion`);
  } catch (e) {
    log.error(`Failed to update config for standalone match ${matchSlug} after veto`, e as Error);
  }
}
