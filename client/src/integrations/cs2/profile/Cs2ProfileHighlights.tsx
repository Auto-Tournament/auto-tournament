import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { CaretRightIcon } from '@phosphor-icons/react';
import { api, SectionHead, textSize, tokens, useModuleTranslation } from '../../../module-sdk';
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
  type PlayerReel,
} from '../highlights/data';
import { FavouriteChip, HighlightCard, KindBadge, thumbAt, VideoThumb } from '../highlights/HighlightCard';

/** One of the three beside the favourite: a still on the left, two lines on the right. */
function SideItem({ to, video, at, title, sub, badge }: { to: string; video: string; at: number; title: string; sub: string; badge?: string }) {
  return (
    <Box
      component={RouterLink}
      to={to}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 46%) minmax(0, 1fr)',
        gap: 1.5,
        alignItems: 'center',
        p: 1,
        borderRadius: '16px',
        bgcolor: tokens.color.paper2,
        border: `1px solid ${tokens.color.rule}`,
        color: 'inherit',
        textDecoration: 'none',
        '&:hover': { borderColor: tokens.color.ink2 },
        '&:focus-visible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: '10px', overflow: 'hidden', bgcolor: tokens.color.paper3 }}>
        <VideoThumb src={video} at={at} />
        {badge && (
          <Box component="span" sx={{ position: 'absolute', top: 6, left: 6, px: 0.75, py: 0.25, borderRadius: 999, bgcolor: tokens.color.accent, color: tokens.color.accentInk, fontSize: '0.625rem', fontWeight: 700 }}>
            {badge}
          </Box>
        )}
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Box sx={{ fontWeight: 600, fontSize: textSize.sm, overflowWrap: 'anywhere' }}>{title}</Box>
        <Box sx={{ fontSize: '0.75rem', color: tokens.color.muted, overflowWrap: 'anywhere' }}>{sub}</Box>
      </Box>
    </Box>
  );
}

/**
 * A player's highlights on their profile (the drafts' profile board): their
 * favourite large (or, until they pick one, their best), three more beside
 * it (the next best, and their newest reel), and "See all" to every one.
 * Nothing at all until a demo of theirs gave a moment worth a clip.
 */
export function Cs2ProfileHighlights({ playerId }: { playerId: string }) {
  const { t } = useModuleTranslation('cs2');
  const [loaded, setLoaded] = useState<(PlayerHighlights & { playerId: string }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & PlayerHighlights>(`/api/game/cs2/players/${encodeURIComponent(playerId)}/highlights`)
      .then((res) => {
        if (!cancelled && res.success) setLoaded({ ...res, playerId });
      })
      .catch(() => {
        // Extra to the profile: leave it out.
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const data = loaded?.playerId === playerId ? loaded : null;
  if (!data) return null;
  const done = data.highlights.filter((h) => h.status === 'done' && h.video);
  const queued = data.highlights.length - done.length;
  if (done.length === 0 && data.reels.length === 0) {
    if (queued === 0) return null;
    return (
      <Box component="section" aria-labelledby="cs2-profile-highlights" data-testid="cs2-profile-highlights" sx={{ mt: 6 }}>
        <SectionHead id="cs2-profile-highlights" title={t('highlights.title')} />
        <Box sx={{ p: 3, borderRadius: '18px', border: `1px dashed ${tokens.color.rule}`, color: tokens.color.muted }}>
          {t('highlights.beingRecorded', { count: queued })}
        </Box>
      </Box>
    );
  }

  const favourite = done.find((h) => h.id === data.favourite) ?? null;
  const lead: Clip | null = favourite ?? done[0] ?? null;
  const reel: PlayerReel | null = data.reels[0] ?? null;
  const others = done.filter((h) => h !== lead).slice(0, reel ? 2 : 3);
  const total = done.length + data.reels.length;
  const clipSub = (c: Clip) =>
    [mapLabel(t, c.map, c.mapNumber), t('highlights.roundN', { n: c.round }), c.markers ? clock(c.markers.duration) : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <Box component="section" aria-labelledby="cs2-profile-highlights" data-testid="cs2-profile-highlights" sx={{ mt: 6 }}>
      <SectionHead
        id="cs2-profile-highlights"
        title={t('highlights.title')}
        action={
          <Box
            component={RouterLink}
            to={playerHighlightsPath(playerId)}
            data-testid="cs2-highlights-see-all"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: tokens.color.ink2, fontSize: textSize.sm, textDecoration: 'none', '&:hover': { color: tokens.color.ink } }}
          >
            {t('highlights.seeAll', { count: total })}
            <CaretRightIcon size={14} />
          </Box>
        }
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.7fr) minmax(0, 1fr)' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {lead ? (
          <Box sx={{ position: 'relative' }}>
            <HighlightCard
              large
              testId="cs2-highlight-lead"
              to={watchClipPath(lead.id)}
              video={lead.video}
              markers={lead.markers}
              title={playTitle(lead.title)}
              sub={[teamsLabel(lead.match), mapLabel(t, lead.map, lead.mapNumber), t('highlights.roundN', { n: lead.round })].filter(Boolean).join(' · ')}
              duration={lead.markers?.duration}
              badge={<KindBadge kind={lead.kind} clutch={lead.clutch} />}
            />
            {favourite && <FavouriteChip />}
          </Box>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {others.map((c) => (
            <SideItem
              key={c.id}
              to={watchClipPath(c.id)}
              video={c.video!}
              at={thumbAt(c.markers)}
              title={playTitle(c.title)}
              sub={clipSub(c)}
            />
          ))}
          {reel && (
            <SideItem
              to={watchReelPath(reel.matchSlug, reel.mapNumber, playerId)}
              video={reel.video}
              at={2}
              badge={t('highlights.reelBadge')}
              title={t('highlights.reelOf', { map: mapLabel(t, reel.map, reel.mapNumber) })}
              sub={t('highlights.moments', { count: reel.moments })}
            />
          )}
          {queued > 0 && (
            <Box sx={{ color: tokens.color.muted, fontSize: '0.75rem', px: 0.5 }}>{t('highlights.queued', { count: queued })}</Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
