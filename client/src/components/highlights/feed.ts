import type { ReactNode } from 'react';
import type { ClipMarkers } from './media';

/** One highlight video as a game hands it to core: a clip, or a reel of several. */
export interface HighlightVideo {
  id: string;
  /** Its own page. */
  to: string;
  /** The video file. */
  video: string;
  /** Where its still is taken, in seconds (default: from `markers`, else 1.5). */
  at?: number;
  markers?: ClipMarkers | null;
  duration?: number;
  /** "4 kills · AK-47", the game's own words. */
  title: string;
  /** "9z vs BETBOOM · Dust II · Round 3". */
  sub: string;
  /** The game's badge over the still (CS2: ACE, 4K, CLUTCH). */
  badge?: ReactNode;
}

/**
 * A player's highlights from one game, for the Highlights section on their
 * profile (`usePlayerHighlights`, client API 0.2.14). Core lays it out; the
 * game only says what there is.
 */
export interface PlayerHighlightsFeed {
  /** Finished clips, best first. */
  videos: HighlightVideo[];
  /** The newest reel, if any: it takes the last place beside the lead. */
  reel?: HighlightVideo | null;
  /** The clip the player chose to lead with. */
  favouriteId?: string | null;
  /** Clips still being made, and about when the last is done. */
  recording?: { count: number; etaMinutes?: number } | null;
  /** Every clip and reel, for "See all N". */
  total: number;
  /** The page with all of them. */
  seeAllPath?: string;
}
