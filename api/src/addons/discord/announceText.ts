/**
 * What a match announcement says, and when (announce.ts), kept apart from the
 * database so they can be checked on their own.
 */

export type AnnounceEvent = 'ready' | 'live' | 'result';

/** Which posts a match is due, from where it is now. */
export function dueEvents(status: string, hasWinner: boolean): AnnounceEvent[] {
  if (status === 'loaded') return ['ready'];
  if (status === 'live') return ['ready', 'live'];
  if (status === 'completed' && hasWinner) return ['result'];
  return [];
}

/** The post's text: "Kestrel vs Halcyon is ready", "... is live", "Kestrel beat Halcyon 2–1". */
export function announceText(
  event: AnnounceEvent,
  team1: string,
  team2: string,
  result: { winner: 1 | 2; score: [number, number] } | null,
  url: string | null
): string {
  let line: string;
  if (event === 'ready') line = `**${team1}** vs **${team2}** is ready: the server is up.`;
  else if (event === 'live') line = `**${team1}** vs **${team2}** is live.`;
  else if (!result) line = `**${team1}** vs **${team2}** is over.`;
  else if (result.winner === 1) {
    line = `**${team1}** beat **${team2}** ${result.score[0]}–${result.score[1]}.`;
  } else {
    line = `**${team2}** beat **${team1}** ${result.score[1]}–${result.score[0]}.`;
  }
  return url ? `${line} ${url}` : line;
}
