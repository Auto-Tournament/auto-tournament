import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import {
  api,
  mono,
  Panel,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
  withAlpha,
} from '../../../module-sdk';
import { getMapDisplayName } from '../maps/mapData';

interface Highlight {
  id: number;
  matchSlug: string;
  mapNumber: number;
  map: string | null;
  kind: string;
  title: string;
  score: number;
  status: 'done' | 'pending' | 'recording';
  video: string | null;
  createdAt: number;
}

interface Reel {
  matchSlug: string;
  mapNumber: number;
  map: string | null;
  moments: number;
  video: string;
  createdAt: number;
}

/**
 * A player's highlights: each map's reel (their moments there, one after the
 * other), then the single moments, the recorded ones first, then the ones the
 * recorder hasn't got to yet. Nothing at all until a demo of theirs gave a
 * moment worth a clip.
 */
export function Cs2ProfileHighlights({ playerId }: { playerId: string }) {
  const { t } = useModuleTranslation('cs2');
  const [loaded, setLoaded] = useState<{
    playerId: string;
    list: Highlight[];
    reels: Reel[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean; highlights: Highlight[]; reels?: Reel[] }>(
        `/api/game/cs2/players/${encodeURIComponent(playerId)}/highlights`
      )
      .then((res) => {
        if (!cancelled && res.success)
          setLoaded({ playerId, list: res.highlights, reels: res.reels ?? [] });
      })
      .catch(() => {
        // Extra to the profile: leave it out.
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const list = loaded?.playerId === playerId ? loaded.list : [];
  const reels = loaded?.playerId === playerId ? loaded.reels : [];
  if (list.length === 0 && reels.length === 0) return null;
  const done = list.filter((h) => h.status === 'done');
  const queued = list.length - done.length;

  return (
    <Box
      component="section"
      aria-labelledby="cs2-profile-highlights"
      data-testid="cs2-profile-highlights"
      sx={{ mt: 6 }}
    >
      <SectionHead
        id="cs2-profile-highlights"
        title={t('highlights.title')}
        action={
          queued > 0 ? (
            <Box component="span" sx={{ color: tokens.color.muted, fontSize: textSize.sm }}>
              {t('highlights.queued', { count: queued })}
            </Box>
          ) : undefined
        }
      />
      {reels.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
            mb: list.length ? 1.5 : 0,
          }}
        >
          {reels.map((r) => (
            <Panel
              key={`${r.matchSlug}-${r.mapNumber}`}
              sx={{ p: 0, overflow: 'hidden' }}
              data-testid="cs2-highlight-reel"
            >
              <Box
                component="video"
                src={r.video}
                controls
                playsInline
                preload="metadata"
                aria-label={t('highlights.reelOf', {
                  map: r.map ? getMapDisplayName(r.map) : t('highlights.mapN', { n: r.mapNumber }),
                })}
                sx={{ display: 'block', width: '100%', aspectRatio: '16 / 9', bgcolor: '#0b0d10' }}
              />
              <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Box sx={{ fontSize: textSize.sm, fontWeight: 600 }}>
                  {t('highlights.reelOf', {
                    map: r.map ? getMapDisplayName(r.map) : t('highlights.mapN', { n: r.mapNumber }),
                  })}
                </Box>
                <Box sx={{ color: tokens.color.muted, fontSize: textSize.xs, fontFamily: mono.fontFamily }}>
                  {t('highlights.moments', { count: r.moments })}
                </Box>
              </Box>
            </Panel>
          ))}
        </Box>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 1.5,
        }}
      >
        {list.map((h) => (
          <Panel key={h.id} sx={{ p: 0, overflow: 'hidden' }} data-testid="cs2-highlight">
            <Box sx={{ position: 'relative', aspectRatio: '16 / 9', bgcolor: '#0b0d10' }}>
              {h.video ? (
                <Box
                  component="video"
                  src={h.video}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={h.title}
                  sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: textSize.sm,
                  }}
                >
                  {t(h.status === 'recording' ? 'highlights.recording' : 'highlights.pending')}
                </Box>
              )}
              <Box
                component="span"
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  px: 1,
                  py: 0.25,
                  borderRadius: 999,
                  fontFamily: mono.fontFamily,
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  bgcolor: withAlpha(tokens.color.accent, 0.9),
                  color: '#0b0d10',
                  pointerEvents: 'none',
                }}
              >
                {h.kind}
              </Box>
            </Box>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Box sx={{ fontSize: textSize.sm, fontWeight: 600 }}>{h.title}</Box>
              <Box sx={{ color: tokens.color.muted, fontSize: textSize.xs, mt: 0.25 }}>
                {h.map ? getMapDisplayName(h.map) : t('highlights.mapN', { n: h.mapNumber })}
              </Box>
            </Box>
          </Panel>
        ))}
      </Box>
    </Box>
  );
}
