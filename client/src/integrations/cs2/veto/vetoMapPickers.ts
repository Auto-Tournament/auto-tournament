import { api } from '../../../module-sdk';
import type { VetoStateResponse } from '../cs2.types';

/**
 * Who picked each map of a match (`mapPickers`), in map order, from the veto's
 * record. Empty when the match had no veto (it answers 404).
 */
export async function vetoMapPickers(matchSlug: string): Promise<Array<'team1' | 'team2' | 'decider' | null>> {
  try {
    const res = await api.get<VetoStateResponse>(`/api/veto/${encodeURIComponent(matchSlug)}`);
    const picked = res.success && res.veto && Array.isArray(res.veto.pickedMaps) ? res.veto.pickedMaps : [];
    const out: Array<'team1' | 'team2' | 'decider' | null> = [];
    for (const pick of picked) {
      const index = (pick.mapNumber || 1) - 1;
      if (index < 0 || index > 15) continue;
      while (out.length <= index) out.push(null);
      out[index] = pick.pickedBy === 'team1' || pick.pickedBy === 'team2' || pick.pickedBy === 'decider' ? pick.pickedBy : null;
    }
    return out;
  } catch {
    return [];
  }
}
