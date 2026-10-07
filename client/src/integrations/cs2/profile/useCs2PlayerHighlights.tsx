import { useEffect, useState } from 'react';
import { api, useModuleTranslation, type HighlightVideo, type PlayerHighlightsFeed } from '../../../module-sdk';
import {
  clock,
  mapLabel,
  playerHighlightsPath,
  playTitle,
  teamsLabel,
  watchClipPath,
  watchReelPath,
  type Clip,
  type PlayerHighlights,
} from '../highlights/data';
import { KindBadge } from '../highlights/KindBadge';

/**
 * A player's CS2 highlights for core's Highlights section (`usePlayerHighlights`):
 * their recorded clips, their newest reel, their favourite and what is still
 * being recorded, worded the CS2 way (map, round, ACE/4K).
 */
export function useCs2PlayerHighlights(playerId: string): PlayerHighlightsFeed | null | undefined {
  const { t } = useModuleTranslation('cs2');
  const [loaded, setLoaded] = useState<{ playerId: string; data: PlayerHighlights | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & PlayerHighlights>(`/api/game/cs2/players/${encodeURIComponent(playerId)}/highlights`)
      .then((res) => {
        if (!cancelled) setLoaded({ playerId, data: res.success ? res : null });
      })
      .catch(() => {
        // Extra to the profile: leave it out.
        if (!cancelled) setLoaded({ playerId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (loaded?.playerId !== playerId) return undefined;
  const data = loaded.data;
  if (!data) return null;

  const done = data.highlights.filter((h) => h.status === 'done' && h.video);
  const queued = data.queue?.count ?? data.highlights.length - done.length;
  const clip = (c: Clip): HighlightVideo => ({
    id: String(c.id),
    to: watchClipPath(c.id),
    video: c.video!,
    markers: c.markers,
    duration: c.markers?.duration,
    title: playTitle(c.title),
    sub: [teamsLabel(c.match), mapLabel(t, c.map, c.mapNumber), t('highlights.roundN', { n: c.round }), c.markers ? clock(c.markers.duration) : null]
      .filter(Boolean)
      .join(' · '),
    badge: <KindBadge kind={c.kind} clutch={c.clutch} />,
  });
  const reel = data.reels[0] ?? null;
  return {
    videos: done.map(clip),
    reel: reel
      ? {
          id: `reel:${reel.matchSlug}:${reel.mapNumber}`,
          to: watchReelPath(reel.matchSlug, reel.mapNumber, playerId),
          video: reel.video,
          at: 2,
          title: t('highlights.reelOf', { map: mapLabel(t, reel.map, reel.mapNumber) }),
          sub: t('highlights.moments', { count: reel.moments }),
        }
      : null,
    favouriteId: data.favourite != null ? String(data.favourite) : null,
    recording: queued > 0 ? { count: queued, etaMinutes: data.queue?.etaMinutes } : null,
    total: done.length + data.reels.length,
    seeAllPath: playerHighlightsPath(playerId),
  };
}
