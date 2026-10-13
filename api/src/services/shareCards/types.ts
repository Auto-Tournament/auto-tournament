/**
 * Share cards (link previews): the 1200×630 image a chat app or social site
 * shows when someone shares a page, drawn per page on request
 * (./render.ts) from one of these descriptions.
 *
 * Core describes match, team, player and tournament pages (./core.ts); a
 * game module adds its own kinds through `GameIntegration.shareCards`
 * (CS2: clips and reels). Designs: the "Share card (OG image)" canvas.
 */

/** An image to draw: its bytes and type (PNG, JPEG or WebP), or null for the fallback. */
export interface CardImage {
  data: Buffer;
  type: string;
}

export interface CardStat {
  label: string;
  value: string;
}

export interface CardTeam {
  name: string;
  logo: CardImage | null;
}

export type CardData =
  | {
      kind: 'clip';
      thumbnail: CardImage | null;
      /** "4K", "Ace", "Clutch"… in the orange pill. */
      tag: string;
      /** "AK-47 · Mirage · round 14". */
      detail: string;
      player: string;
      /** "Team Alpha vs Team Bravo · Spring Cup". */
      context: string;
    }
  | {
      kind: 'match';
      /** "Spring Cup · Upper bracket final · BO3". */
      header: string;
      status: { label: string; tone: 'live' | 'done' | 'next' };
      team1: CardTeam;
      team2: CardTeam;
      /** Series score, or null before it starts ("vs"). */
      score: [number, number] | null;
      /** Per-map (or per-game) chips: "Mirage 13–9", "Game 1 · 3–2". */
      chips: string[];
      /** Shown instead of the chips when there are none: "Map veto · starts 18:30". */
      footer: string | null;
    }
  | {
      kind: 'team';
      /** "Team · CS2". */
      label: string;
      name: string;
      logo: CardImage | null;
      /** Wins / losses / titles, or a one-line note for a new team. */
      stats: CardStat[];
      note: string | null;
      members: { name: string; avatar: CardImage | null }[];
      memberCount: number;
    }
  | {
      kind: 'player';
      name: string;
      avatar: CardImage | null;
      /** "Team Alpha · Level 23", or the main game's name and team. */
      sub: string;
      /** The main game's rating (Elo), and this month's change. */
      rating: number | null;
      ratingChange: number;
      stats: CardStat[];
      /** "Also plays CS2, Valorant". */
      footer: string | null;
    }
  | {
      kind: 'tournament';
      /** "Tournament · CS2". */
      label: string;
      name: string;
      /** "Double elimination · 8 teams · 17–18 October". */
      sub: string;
      banner: CardImage | null;
      /** "Sign-up open", "Live now"; null when there is a champion. */
      badge: string | null;
      champion: CardTeam | null;
    }
  | {
      kind: 'reel';
      /** "Match reel · 10 plays · 2:41". */
      label: string;
      title: string;
      sub: string;
      thumbnails: CardImage[];
    };

/** What a share page's HTML says about itself, and its card. */
export interface ShareMeta {
  title: string;
  description: string;
  /** Changes whenever the card would look different (part of the image URL and cache key). */
  version: string;
}

/**
 * One kind of shareable page: which paths it covers, what their tags say and
 * how their card looks. `key` is what the page path names (a slug, an id,
 * `<slug>/<map>`): URL-safe, at most 200 characters.
 */
export interface ShareKind {
  kind: string;
  /** The key for a page path this kind covers, or null. */
  match(pathname: string): string | null;
  meta(key: string): Promise<ShareMeta | null>;
  card(key: string): Promise<CardData | null>;
}
