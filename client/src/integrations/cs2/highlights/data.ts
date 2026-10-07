/**
 * Highlights as the API hands them out (api/src/integrations/cs2/demos/
 * highlightViews.ts), the pages' URLs, and the labels the pages share.
 */

import type { TFunction } from 'i18next';
import { getMapDisplayName } from '../maps/mapData';

/** Where a clip's kills and slow motion are, in seconds of the video. */
export interface ClipMarkers {
  duration: number;
  kills: number[];
  slowmo: [number, number] | null;
}

/** The match a highlight or reel is from. */
export interface MatchRef {
  slug: string;
  team1: string | null;
  team2: string | null;
  tournamentId: number | null;
  tournament: string | null;
  round: number | null;
  bracket: string | null;
  matchNumber: number | null;
}

export interface Clip {
  id: number;
  matchSlug: string;
  mapNumber: number;
  map: string | null;
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  kind: string;
  clutch: boolean;
  title: string;
  score: number;
  status: 'done' | 'pending' | 'recording';
  round: number;
  video: string | null;
  markers: ClipMarkers | null;
  match: MatchRef;
  createdAt: number;
}

/** One clip in a reel; `at` is where it starts (null when a clip before it has no known length). */
export interface Chapter {
  highlightId: number;
  playerId: string;
  playerName: string;
  kind: string;
  clutch: boolean;
  title: string;
  map: string | null;
  round: number;
  at: number | null;
}

export interface PlayerReel {
  matchSlug: string;
  mapNumber: number;
  map: string | null;
  moments: number;
  video: string;
  chapters: Chapter[];
  match: MatchRef;
  createdAt: number;
}

export interface PlayerHighlights {
  reels: PlayerReel[];
  highlights: Clip[];
  favourite: number | null;
  isOwn: boolean;
}

export interface TournamentReel {
  status: string;
  video: string | null;
  chapters: Chapter[];
  duration: number | null;
}

export interface TournamentMatchReels {
  slug: string;
  team1: string | null;
  team2: string | null;
  round: number;
  bracket: string | null;
  matchNumber: number;
  playersDone: number;
  playersTotal: number;
  recording: boolean;
  reels: Array<{ mapNumber: number; map: string | null; status: string; clips: number | null; video: string | null }>;
}

export interface TournamentHighlights {
  reel: TournamentReel | null;
  plays: Clip[];
  matches: TournamentMatchReels[];
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export const highlightPaths = {
  player: '/player/:playerId/highlights',
  watch: '/watch/*',
} as const;

const enc = encodeURIComponent;
export const playerHighlightsPath = (playerId: string) => `/player/${enc(playerId)}/highlights`;
export const watchClipPath = (id: number) => `/watch/clip/${id}`;
export const watchReelPath = (matchSlug: string, mapNumber: number, playerId: string) =>
  `/watch/reel/${enc(matchSlug)}/${mapNumber}/${enc(playerId)}`;
export const watchMatchReelPath = (matchSlug: string, mapNumber: number) =>
  `/watch/match/${enc(matchSlug)}/${mapNumber}`;
export const watchTournamentReelPath = (tournamentId: number) => `/watch/tournament/${tournamentId}`;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** What a highlight is, for its badge: ACE, 4K, CLUTCH, FUNNY… */
export function kindLabel(t: TFunction, kind: string, clutch = false): string {
  if (kind === 'ace') return t('highlights.kind.ace');
  if (kind === 'funny') return t('highlights.kind.funny');
  if (kind === 'clutch' || (clutch && !/^\dk$/.test(kind))) return t('highlights.kind.clutch');
  if (/^\dk$/.test(kind)) return clutch ? t('highlights.kind.multiClutch', { n: kind[0] }) : kind.toUpperCase();
  return t('highlights.kind.flair');
}

/** A big play (ace, 4K) gets the accent badge; the rest a quiet one. */
export const isBigPlay = (kind: string) => kind === 'ace' || kind === '4k';

/** Which filter chip a highlight falls under. */
export type HighlightFilter = 'all' | 'multi' | 'clutch' | 'flair' | 'funny';
export function inFilter(c: { kind: string; clutch: boolean }, filter: HighlightFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'multi') return c.kind === 'ace' || c.kind === '4k';
  if (filter === 'clutch') return c.clutch || c.kind === 'clutch';
  if (filter === 'flair') return c.kind === 'flair';
  return c.kind === 'funny';
}

export const mapLabel = (t: TFunction, map: string | null, mapNumber: number) =>
  map ? getMapDisplayName(map) : t('highlights.mapN', { n: mapNumber + 1 });

/** "9z vs BETBOOM", or what is known of it. */
export function teamsLabel(match: Pick<MatchRef, 'team1' | 'team2'>): string {
  if (match.team1 && match.team2) return `${match.team1} vs ${match.team2}`;
  return match.team1 ?? match.team2 ?? '';
}

/** The title without its trailing " · round N" (the card says the round itself). */
export const playTitle = (title: string) => title.replace(/ · round \d+$/, '');

/** m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
