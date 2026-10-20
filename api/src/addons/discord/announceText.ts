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

/** Everything a card can show; what is not known is left out. */
export interface CardInput {
  event: AnnounceEvent;
  team1: string;
  team2: string;
  url: string | null;
  roles: { team1: string | null; team2: string | null };
  /** "Winter LAN", "Semi-final", "Bo3", ["Mirage", "Inferno", "Nuke"]. */
  tournament?: string | null;
  stage?: string | null;
  format?: string | null;
  maps?: string[];
  /** The live card once the match is over: its last score, "Over on ...". */
  over?: boolean;
  /** The map being played, for the live card (edited as it goes). */
  live?: {
    map: string | null;
    mapNumber: number;
    totalMaps: number;
    score: [number, number];
    round: number;
    series: [number, number];
  } | null;
  result?: {
    winner: 1 | 2;
    /** Maps won (a Bo1: the map's rounds). */
    score: [number, number];
    maps: Array<{ map: string | null; score: [number, number] }>;
    top?: { name: string; kills: number; deaths: number; adr: number | null } | null;
    /** "Final vs Halcyon", "Final, opponent to be decided", "Champions". */
    next?: string | null;
  } | null;
}

/** The card's first line: who plays, who is up, who won. */
export function headline(c: CardInput): string {
  const a = `**${c.team1}**`;
  const b = `**${c.team2}**`;
  if (c.event === 'ready') return `${a} vs ${b} is ready: the server is up.`;
  if (c.event === 'live') {
    if (!c.live) return `${a} vs ${b} is live.`;
    const where = [
      c.live.totalMaps > 1 ? `map ${c.live.mapNumber + 1} of ${c.live.totalMaps}` : null,
      c.live.map,
    ]
      .filter(Boolean)
      .join(', ');
    const word = c.over ? 'Over' : 'Live';
    return `${word}${where ? ` on ${where}` : ''}: ${a} **${c.live.score[0]}–${c.live.score[1]}** ${b}`;
  }
  if (!c.result) return `${a} vs ${b} is over.`;
  const [w, l] = c.result.winner === 1 ? [a, b] : [b, a];
  const s = c.result.winner === 1 ? c.result.score : [c.result.score[1], c.result.score[0]];
  return `${w} beat ${l} ${s[0]}–${s[1]}.`;
}

const ACCENT = 0xff6a3d;
const WON = 0x3ba55d;

type Field = { name: string; value: string; inline?: boolean };

function fields(c: CardInput): Field[] {
  const out: Field[] = [];
  if (c.event === 'ready') {
    if (c.format) out.push({ name: 'Format', value: c.format, inline: true });
    if (c.maps?.length) out.push({ name: 'Maps', value: c.maps.join(', '), inline: true });
  }
  if (c.event === 'live' && c.live && !c.over) {
    out.push({ name: 'Round', value: String(c.live.round), inline: true });
    if (c.live.totalMaps > 1) {
      out.push({ name: 'Series', value: `${c.live.series[0]}–${c.live.series[1]}`, inline: true });
    }
  }
  if (c.event === 'result' && c.result) {
    const maps = c.result.maps
      .map((m) => `${m.map ?? 'Map'} ${m.score[0]}–${m.score[1]}`)
      .join('\n');
    if (maps) {
      out.push({ name: c.result.maps.length > 1 ? 'Maps' : 'Map', value: maps, inline: true });
    }
    const top = c.result.top;
    if (top) {
      const adr = top.adr !== null ? `, ${Math.round(top.adr)} ADR` : '';
      out.push({
        name: 'Top player',
        value: `${top.name}: ${top.kills}–${top.deaths}${adr}`,
        inline: true,
      });
    }
    if (c.result.next) out.push({ name: 'Next', value: c.result.next });
  }
  return out;
}

/**
 * The post as Discord takes it: a card with the headline, the details for its
 * stage and a "Go to match" button; for ready and live a ping of both teams'
 * roles ("@Kestrel vs @Halcyon") when they have one. A result pings nobody.
 * The live card is edited as the score moves (announce.ts); an edit pings no one.
 */
export function announceMessage(c: CardInput) {
  const ping =
    c.event !== 'result' && c.roles.team1 && c.roles.team2 ? [c.roles.team1, c.roles.team2] : [];
  const footer = [c.tournament, c.stage].filter(Boolean).join(' · ');
  const f = fields(c);
  return {
    ...(ping.length ? { content: `<@&${ping[0]}> vs <@&${ping[1]}>` } : {}),
    embeds: [
      {
        title: `${c.team1} vs ${c.team2}`,
        description: headline(c),
        color: c.event === 'result' ? WON : ACCENT,
        ...(f.length ? { fields: f } : {}),
        ...(footer ? { footer: { text: footer } } : {}),
        ...(c.url ? { url: c.url } : {}),
      },
    ],
    ...(c.url
      ? {
          components: [
            { type: 1, components: [{ type: 2, style: 5, label: 'Go to match', url: c.url }] },
          ],
        }
      : {}),
    allowed_mentions: { parse: [], roles: ping },
  };
}
