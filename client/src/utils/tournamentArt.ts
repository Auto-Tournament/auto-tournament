/**
 * A tournament's picture, the one way every page draws it (the front page's
 * cards, Browse, the tournament page's header): its uploaded banner, else the
 * map picture the organizer picked (`settings.bannerMap`), else — where a
 * picture is wanted anyway — a map picked by its id, so it stays put.
 */
import { getMapImageUrl } from '../constants/maps';
import { tokens } from '../theme/tokens';

/** Map art for a tournament without a banner or a picked map. */
export const FALLBACK_ART_MAPS = [
  'de_ancient',
  'de_mirage',
  'de_dust2',
  'de_inferno',
  'de_nuke',
  'de_anubis',
  'de_overpass',
];

export interface ArtTournament {
  id: number;
  bannerUrl?: string | null;
  /** The picked map, from the list (`bannerMap`) or the settings. */
  bannerMap?: string | null;
  settings?: unknown;
}

function pickedMap(t: ArtTournament): string | null {
  if (t.bannerMap) return t.bannerMap;
  const map = (t.settings as { bannerMap?: unknown } | undefined)?.bannerMap;
  return typeof map === 'string' && map ? map : null;
}

/** The picture's URL; with `fallback: false`, null when the organizer chose none. */
export function tournamentArtUrl(
  t: ArtTournament,
  opts: { fallback?: boolean } = {}
): string | null {
  if (t.bannerUrl) return t.bannerUrl;
  const map = pickedMap(t);
  if (map) return getMapImageUrl(map);
  if (opts.fallback === false) return null;
  return getMapImageUrl(FALLBACK_ART_MAPS[Math.abs(t.id) % FALLBACK_ART_MAPS.length]);
}

/** The picture as a background (cover, a little above centre), on paper3 while it loads. */
export function tournamentArtSx(t: ArtTournament, opts: { fallback?: boolean } = {}) {
  const url = tournamentArtUrl(t, opts);
  return url
    ? {
        backgroundImage: `url("${url}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center 40%',
        bgcolor: tokens.color.paper3,
      }
    : { bgcolor: tokens.color.paper2 };
}
