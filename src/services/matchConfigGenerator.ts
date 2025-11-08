import { db } from '../config/database';
import type { DbTeamRow, DbMatchRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';
import type { MatchConfig } from '../types/match.types';
import { log } from '../utils/logger';

export const generateMatchConfig = async (
  tournament: TournamentResponse,
  team1Id?: string,
  team2Id?: string,
  slug?: string
): Promise<MatchConfig> => {
  // 1) DB reads (await!)
  const team1 = team1Id
    ? await db.queryOne<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [
        team1Id,
      ])
    : null;
  const team2 = team2Id
    ? await db.queryOne<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [
        team2Id,
      ])
    : null;

  const numMaps = tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5;

  const team1Players = team1 ? JSON.parse(team1.players || '{}') : {};
  const team2Players = team2 ? JSON.parse(team2.players || '{}') : {};
  const team1Count = Object.keys(team1Players).length;
  const team2Count = Object.keys(team2Players).length;

  const playersPerTeam = Math.max(team1Count, team2Count, 1);

  // Defaults (used when no veto yet)
  let maplist: string[] = tournament.maps;
  // We'll carry *per map* sides here, based on the UI veto
  type PerMapSide = 'team1_ct' | 'team2_ct' | 'knife';
  let per_map_sides: PerMapSide[] = Array.from({ length: numMaps }, () => 'knife');

  // 2) If we have a match/veto, use it
  console.log('slug', slug);
  if (slug) {
    const match = await db.queryOne<DbMatchRow>('SELECT veto_state FROM matches WHERE slug = ?', [
      slug,
    ]);
    console.log('match', match);
    if (match?.veto_state) {
      console.log('match.veto_state', match.veto_state);
      try {
        const veto = JSON.parse(match.veto_state) as {
          status: 'in_progress' | 'completed';
          pickedMaps: Array<{
            mapName: string;
            mapNumber: number; // used in the UI
            sideTeam1?: 'CT' | 'T'; // set during side_pick
          }>;
        };

        console.log('veto', veto);

        console.log('veto.status', veto?.status);
        console.log('veto.pickedMaps', veto?.pickedMaps);
        console.log('veto.pickedMaps.length', veto?.pickedMaps?.length);

        if (
          veto?.status === 'completed' &&
          Array.isArray(veto.pickedMaps) &&
          veto.pickedMaps.length > 0
        ) {
          // 2a) Order by mapNumber to match the BO1/3/5 series order shown in UI
          const ordered = [...veto.pickedMaps].sort(
            (a, b) => (a.mapNumber ?? 0) - (b.mapNumber ?? 0)
          );

          // 2b) Build maplist from the ordered picks
          maplist = ordered.map((p) => p.mapName);
          maplist = maplist.slice(0, numMaps); // ensure we only have the number of maps we need

          console.log('maplist', maplist);

          // 2c) Translate side picks (UI is per-map; backend previously only had a global toggle)
          per_map_sides = ordered.map((p) => {
            if (p.sideTeam1 === 'CT') return 'team1_ct';
            if (p.sideTeam1 === 'T') return 'team2_ct';
            // If side wasn't chosen (e.g., your flow decides by knife), fall back to knife
            return 'knife';
          });
        }
      } catch (e) {
        console.error('Failed to parse veto_state JSON:', e);
        // fall back to tournament defaults
      }
    }
  }

  // 3) Global map_sides is too coarse for mixed choices. Keep a safe default,
  //    but also include per_map_sides so your allocator / gameserver can apply it precisely.
  //    If your server *does* support per-map sides natively, translate `per_map_sides`
  //    to whatever structure it expects right here.
  const anyKnife = per_map_sides.some((s) => s === 'knife');
  const map_sides_global: Array<'team1_ct' | 'team2_ct' | 'knife'> = anyKnife
    ? ['team1_ct', 'team2_ct', 'knife']
    : ['team1_ct', 'team2_ct'];

  const config: MatchConfig = {
    matchid: slug || 'tbd',
    num_maps: numMaps,
    players_per_team: playersPerTeam,
    min_players_to_ready: 1,
    min_spectators_to_ready: 0,
    wingman: false,

    // veto
    skip_veto: true,
    maplist, // ordered maps from the veto
    map_sides: map_sides_global,

    // >>> new: carry per-map sides chosen in the UI <<<
    // Your allocator / match loader should read this and configure the server accordingly.
    // veto_per_map_sides: per_map_sides, // ['team1_ct' | 'team2_ct' | 'knife'] per map index

    spectators: { players: {} },

    // Custom fields used by your frontend
    expected_players_total: team1Count + team2Count,
    expected_players_team1: team1Count,
    expected_players_team2: team2Count,
    team1: team1
      ? {
          id: team1.id,
          name: team1.name,
          tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
          players: team1Players,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
    team2: team2
      ? {
          id: team2.id,
          name: team2.name,
          tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
          players: team2Players,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
  };

  log.info('Match configgg:', config);
  return config;
};
