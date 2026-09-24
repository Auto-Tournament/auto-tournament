/**
 * The one-line series result MAT logs on `series_end`.
 *
 * Auto Tournament CS2's `series_end` payload carries scores and a winner side but no team
 * names (only `series_start` has them), so reading `team1_name` off the event
 * logged "SERIES ENDED: undefined 0-1 undefined" for every match. Names come
 * from the payload when a plugin sends them, otherwise from what MAT knows
 * about the match (team rows, then the stored config), otherwise the side.
 */
type NameSource = string | null | undefined;

function firstName(...candidates: NameSource[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return null;
}

function payloadTeamName(event: Record<string, unknown>, side: 'team1' | 'team2'): NameSource {
  const flat = event[`${side}_name`];
  if (typeof flat === 'string') return flat;
  const nested = event[side] as { name?: unknown } | undefined;
  return nested && typeof nested.name === 'string' ? nested.name : undefined;
}

export function formatSeriesEndSummary(
  event: Record<string, unknown>,
  known: {
    team1Name?: NameSource;
    team2Name?: NameSource;
    configTeam1Name?: NameSource;
    configTeam2Name?: NameSource;
  }
): string {
  const team1 =
    firstName(payloadTeamName(event, 'team1'), known.team1Name, known.configTeam1Name) ?? 'team1';
  const team2 =
    firstName(payloadTeamName(event, 'team2'), known.team2Name, known.configTeam2Name) ?? 'team2';
  const score1 = Number(event.team1_series_score) || 0;
  const score2 = Number(event.team2_series_score) || 0;
  return `SERIES ENDED: ${team1} ${score1}-${score2} ${team2}`;
}
