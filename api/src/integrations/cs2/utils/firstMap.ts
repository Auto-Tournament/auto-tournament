import type { DbMatchRow } from '../../../types/database.types';

/** The series' first map, for the "server ready" chat line: the config's map list, else the veto's first pick. */
export function firstMapOf(match: Pick<DbMatchRow, 'config' | 'veto_state'>): string {
  try {
    const config = match.config ? (JSON.parse(match.config) as { maplist?: string[] }) : null;
    if (config?.maplist?.[0]) return config.maplist[0];
  } catch {
    // fall through
  }
  try {
    const veto = match.veto_state ? (JSON.parse(match.veto_state) as { pickedMaps?: Array<{ mapName: string; mapNumber: number }> }) : null;
    const first = [...(veto?.pickedMaps ?? [])].sort((a, b) => a.mapNumber - b.mapNumber)[0];
    return first?.mapName ?? '';
  } catch {
    return '';
  }
}
