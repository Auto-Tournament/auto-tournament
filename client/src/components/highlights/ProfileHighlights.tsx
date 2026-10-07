import { Link as RouterLink } from 'react-router-dom';
import { Box, Skeleton } from '@mui/material';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { SectionHead } from '../common/ui';
import { textSize, tokens } from '../../theme/tokens';
import { FavouriteChip, HighlightCard, RecordingCard, RecordingDot, thumbAt, VideoThumb } from './HighlightCard';
import type { HighlightVideo, PlayerHighlightsFeed } from './feed';

/** One of the three beside the lead: a still on the left, two lines on the right. */
function SideItem({ item, reel }: { item: HighlightVideo; reel?: boolean }) {
  const { t } = useTranslation();
  return (
    <Box
      component={RouterLink}
      to={item.to}
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
        <VideoThumb src={item.video} at={item.at ?? thumbAt(item.markers)} />
        {reel && (
          <Box
            component="span"
            sx={{ position: 'absolute', top: 6, left: 6, px: 0.75, py: 0.25, borderRadius: 999, bgcolor: tokens.color.accent, color: tokens.color.accentInk, fontSize: '0.625rem', fontWeight: 700 }}
          >
            {t('videoHighlights.reelBadge')}
          </Box>
        )}
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Box sx={{ fontWeight: 600, fontSize: textSize.sm, overflowWrap: 'anywhere' }}>{item.title}</Box>
        <Box sx={{ fontSize: '0.75rem', color: tokens.color.muted, overflowWrap: 'anywhere' }}>{item.sub}</Box>
      </Box>
    </Box>
  );
}

/** A side item still being recorded: the same shape, shimmering. */
function RecordingSideItem() {
  return (
    <Box
      aria-hidden
      sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 46%) minmax(0, 1fr)', gap: 1.5, alignItems: 'center', p: 1, borderRadius: '16px', bgcolor: tokens.color.paper2, border: `1px solid ${tokens.color.rule}` }}
    >
      <Skeleton variant="rectangular" animation="wave" sx={{ aspectRatio: '16 / 9', height: 'auto', borderRadius: '10px', bgcolor: tokens.color.paper3 }} />
      <Box>
        <Skeleton animation="wave" width="80%" sx={{ bgcolor: tokens.color.paper3 }} />
        <Skeleton animation="wave" width="50%" sx={{ bgcolor: tokens.color.paper3 }} />
      </Box>
    </Box>
  );
}

/**
 * A player's highlights on their profile, from the open game: their
 * favourite large (or, until they pick one, their best), three more beside
 * it (the next best, and their newest reel), and "See all". While clips are
 * still being made, the section as it will look, shimmering. Nothing at all
 * when the game has none and is making none.
 */
export function ProfileHighlights({ feed }: { feed: PlayerHighlightsFeed }) {
  const { t } = useTranslation();
  const queued = feed.recording?.count ?? 0;
  const eta = feed.recording?.etaMinutes != null ? t('videoHighlights.readyIn', { minutes: feed.recording.etaMinutes }) : undefined;

  if (feed.videos.length === 0 && !feed.reel) {
    if (queued === 0) return null;
    return (
      <Box component="section" aria-labelledby="profile-highlights" data-testid="profile-highlights" sx={{ mt: 6 }}>
        <SectionHead id="profile-highlights" title={t('videoHighlights.title')} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.7fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
          <RecordingCard large label={t('videoHighlights.beingRecorded', { count: queued })} hint={eta} />
          <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', gap: 1.5 }}>
            {[0, 1, 2].map((i) => (
              <RecordingSideItem key={i} />
            ))}
          </Box>
        </Box>
      </Box>
    );
  }

  const favourite = feed.videos.find((v) => v.id === feed.favouriteId) ?? null;
  const lead = favourite ?? feed.videos[0] ?? null;
  const others = feed.videos.filter((v) => v !== lead).slice(0, feed.reel ? 2 : 3);

  return (
    <Box component="section" aria-labelledby="profile-highlights" data-testid="profile-highlights" sx={{ mt: 6 }}>
      <SectionHead
        id="profile-highlights"
        title={t('videoHighlights.title')}
        action={
          feed.seeAllPath ? (
            <Box
              component={RouterLink}
              to={feed.seeAllPath}
              data-testid="profile-highlights-see-all"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: tokens.color.ink2, fontSize: textSize.sm, textDecoration: 'none', '&:hover': { color: tokens.color.ink } }}
            >
              {t('videoHighlights.seeAll', { count: feed.total })}
              <CaretRightIcon size={14} />
            </Box>
          ) : undefined
        }
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.7fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
        {lead && (
          <Box sx={{ position: 'relative' }}>
            <HighlightCard
              large
              testId="profile-highlight-lead"
              to={lead.to}
              video={lead.video}
              markers={lead.markers ?? null}
              title={lead.title}
              sub={lead.sub}
              duration={lead.duration ?? lead.markers?.duration}
              badge={lead.badge}
            />
            {favourite && <FavouriteChip />}
          </Box>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {others.map((v) => (
            <SideItem key={v.id} item={v} />
          ))}
          {feed.reel && <SideItem item={feed.reel} reel />}
          {queued > 0 && (
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: tokens.color.muted, fontSize: '0.75rem', px: 0.5 }}>
              <RecordingDot />
              {[t('videoHighlights.queued', { count: queued }), eta].filter(Boolean).join(' · ')}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
