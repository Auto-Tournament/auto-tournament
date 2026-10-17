/**
 * The map a matchmaking match is played on, from its stored config and veto state.
 * A vetoed match's maplist is the whole pool until the veto completes, so it has no map
 * yet; once complete the veto's first pick is the map.
 */
export function mapFromMatch(m: { config: string | null; veto_state: string | null }): string {
  try {
    const cfg = m.config
      ? (JSON.parse(m.config) as { vetoDisabled?: boolean; maplist?: string[] })
      : {};
    if (cfg.vetoDisabled === false) {
      const st = m.veto_state
        ? (JSON.parse(m.veto_state) as {
            status?: string;
            pickedMaps?: Array<{ mapName?: string; mapNumber?: number }>;
          })
        : null;
      if (st?.status !== 'completed') return '';
      const first = [...(st.pickedMaps ?? [])].sort(
        (a, b) => (a.mapNumber ?? 0) - (b.mapNumber ?? 0)
      )[0];
      return first?.mapName || cfg.maplist?.[0] || '';
    }
    return cfg.maplist?.[0] ?? '';
  } catch {
    return '';
  }
}
