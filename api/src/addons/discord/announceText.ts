/**
 * What a match announcement says, and when (announce.ts), kept apart from the
 * database so they can be checked on their own.
 */

/** A team's card for a match goes through these, edited each time, then 'result' (Done). */
export type FeedStage = 'scheduled' | 'veto' | 'ready' | 'live';
export type AnnounceEvent = FeedStage | 'result';

/** Where the match's #matches message is, from where the match is now; null: it has none. */
export function feedStage(
  status: string,
  vetoStatus: string | null,
  bothTeams: boolean
): FeedStage | null {
  if (status === 'live') return 'live';
  if (status === 'loaded') return 'ready';
  if ((status === 'pending' || status === 'ready') && bothTeams) {
    return vetoStatus === 'in_progress' ? 'veto' : 'scheduled';
  }
  return null;
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
  /** When a scheduled match starts (unix s). */
  startsAt?: number | null;
  /** The veto so far, and who is up: 'ban', 'pick' or 'side'. */
  veto?: {
    banned: string[];
    picked: string[];
    next: { team: 1 | 2; action: string } | null;
  } | null;
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
    /** discordId: the player's linked Discord account, mentioned instead of the name. */
    top?: {
      name: string;
      kills: number;
      deaths: number;
      adr: number | null;
      discordId?: string | null;
    } | null;
    /** "Final vs Halcyon", "Final, opponent to be decided", "Champions". */
    next?: string | null;
  } | null;
}

/** A team as the card names it: its role mentioned when it has one (no ping in an embed), else in bold. */
export function teamLabel(name: string, roleId: string | null | undefined): string {
  return roleId ? `<@&${roleId}>` : `**${name}**`;
}

/** The card's first line: who plays, who is up, who won. */
export function headline(c: CardInput): string {
  const a = teamLabel(c.team1, c.roles.team1);
  const b = teamLabel(c.team2, c.roles.team2);
  if (c.event === 'scheduled') {
    return c.startsAt ? `${a} vs ${b} starts <t:${c.startsAt}:R>.` : `${a} vs ${b} is coming up.`;
  }
  if (c.event === 'veto') {
    const next = c.veto?.next;
    if (!next) return `${a} vs ${b}: map veto.`;
    return `${a} vs ${b}: map veto, ${next.team === 1 ? a : b} to ${next.action}.`;
  }
  if (c.event === 'ready') return `${a} vs ${b} is ready: the server is up.`;
  if (c.event === 'live') {
    if (!c.live) return `${a} vs ${b} is live.`;
    const where = [
      c.live.totalMaps > 1 ? `map ${c.live.mapNumber + 1} of ${c.live.totalMaps}` : null,
      c.live.map,
    ]
      .filter(Boolean)
      .join(', ');
    return `Live${where ? ` on ${where}` : ''}: ${a} **${c.live.score[0]}–${c.live.score[1]}** ${b}`;
  }
  if (!c.result) return `${a} vs ${b} is over.`;
  const [w, l] = c.result.winner === 1 ? [a, b] : [b, a];
  const s = c.result.winner === 1 ? c.result.score : [c.result.score[1], c.result.score[0]];
  // Level: an elimination match is decided on a tiebreak (core matchLifecycle, series guard).
  if (s[0] === s[1]) return `${w} go through against ${l} on a tiebreak (${s[0]}–${s[1]}).`;
  return `${w} beat ${l} ${s[0]}–${s[1]}.`;
}

// The one ping, when the team's card is first posted (whatever stage it is at by then).
const PING_TEXT: Record<AnnounceEvent, string> = {
  scheduled: 'your next match.',
  veto: 'your next match: the map veto is open.',
  ready: 'your match is ready.',
  live: 'your match is live.',
  result: 'your match is done.',
};

const STAGE_WORD: Record<AnnounceEvent, string> = {
  scheduled: 'Scheduled',
  veto: 'Map veto',
  ready: 'Ready',
  live: 'Live',
  result: 'Done',
};

// Discord's grey, amber and green; the results in Auto Tournament's orange.
const COLORS: Record<AnnounceEvent, number> = {
  scheduled: 0x80848e,
  veto: 0xf0b232,
  ready: 0x3ba55d,
  live: 0x3ba55d,
  result: 0xff6a3d,
};

type Field = { name: string; value: string; inline?: boolean };

function fields(c: CardInput): Field[] {
  const out: Field[] = [];
  if (c.event === 'veto' && c.veto) {
    if (c.veto.banned.length) {
      out.push({ name: 'Banned', value: c.veto.banned.join(', '), inline: true });
    }
    if (c.veto.picked.length) {
      out.push({ name: 'Picked', value: c.veto.picked.join(', '), inline: true });
    }
  }
  if (c.event === 'scheduled' || c.event === 'ready') {
    if (c.format) out.push({ name: 'Format', value: c.format, inline: true });
    if (c.maps?.length) out.push({ name: 'Maps', value: c.maps.join(', '), inline: true });
  }
  if (c.event === 'live' && c.live) {
    out.push({ name: 'Round', value: String(c.live.round), inline: true });
    if (c.live.totalMaps > 1) {
      out.push({ name: 'Series', value: `${c.live.series[0]}–${c.live.series[1]}`, inline: true });
    }
  }
  if (c.event === 'result' && c.result) {
    // From the winner's side, as the headline reads.
    const w = c.result.winner === 1 ? 0 : 1;
    const maps = c.result.maps
      .map((m) => `${m.map ?? 'Map'} ${m.score[w]}–${m.score[1 - w]}`)
      .join('\n');
    if (maps) {
      out.push({ name: c.result.maps.length > 1 ? 'Maps' : 'Map', value: maps, inline: true });
    }
    const top = c.result.top;
    if (top) {
      const adr = top.adr !== null ? `, ${Math.round(top.adr)} ADR` : '';
      out.push({
        name: 'Top player',
        value: `${top.discordId ? `<@${top.discordId}>` : top.name}: ${top.kills}–${top.deaths}${adr}`,
        inline: true,
      });
    }
    if (c.result.next) out.push({ name: 'Next', value: c.result.next });
  }
  return out;
}

/**
 * The post as Discord takes it: a card with the headline, the details for its
 * stage and a "Go to match" button. `ping` is the team's role, when its card
 * is first posted in its own channel ("@Kestrel, your next match"); the card
 * is then edited as the match moves on (announce.ts), and an edit pings no one.
 */
export function announceMessage(c: CardInput, ping: string | null = null) {
  const footer = [c.tournament, c.stage].filter(Boolean).join(' · ');
  const f = fields(c);
  return {
    ...(ping ? { content: `<@&${ping}>, ${PING_TEXT[c.event]}` } : {}),
    embeds: [
      {
        title: `${c.team1} vs ${c.team2} · ${STAGE_WORD[c.event]}`,
        description: headline(c),
        color: COLORS[c.event],
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
    allowed_mentions: { parse: [], roles: ping ? [ping] : [] },
  };
}
