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

const ACCENT = 0xff6a3d;

/**
 * The post as Discord takes it: a card with the line and a "Go to match"
 * button, and for ready and live a ping of both teams' roles ("@Kestrel vs
 * @Halcyon") when they have one. A result pings nobody.
 */
export function announceMessage(
  event: AnnounceEvent,
  team1: string,
  team2: string,
  result: { winner: 1 | 2; score: [number, number] } | null,
  url: string | null,
  roles: { team1: string | null; team2: string | null }
) {
  const ping = event !== 'result' && roles.team1 && roles.team2 ? [roles.team1, roles.team2] : [];
  return {
    ...(ping.length ? { content: `<@&${ping[0]}> vs <@&${ping[1]}>` } : {}),
    embeds: [
      {
        title: `${team1} vs ${team2}`,
        description: announceText(event, team1, team2, result, null),
        color: ACCENT,
        ...(url ? { url } : {}),
      },
    ],
    ...(url
      ? {
          components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Go to match', url }] }],
        }
      : {}),
    allowed_mentions: { parse: [], roles: ping },
  };
}
