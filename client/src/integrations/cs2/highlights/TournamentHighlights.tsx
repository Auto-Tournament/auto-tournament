import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase } from '@mui/material';
import { PlayIcon } from '@phosphor-icons/react';
import {
  api,
  fontDisplay,
  mono,
  radii,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import type { TournamentResultsSectionProps, TournamentTabProps } from '../../types';
import {
  clock,
  inFilter,
  mapLabel,
  playTitle,
  teamsLabel,
  watchClipPath,
  watchMatchReelPath,
  watchTournamentReelPath,
  type Clip,
  type HighlightFilter,
  type TournamentHighlights,
} from './data';
import { HighlightCard, KindBadge, thumbAt, VideoThumb } from './HighlightCard';
import { Chip } from './PlayerHighlightsPage';

/** A tournament's highlights, loaded once per tournament. */
function useTournamentHighlights(tournamentId: number) {
  const [data, setData] = useState<{ id: number; h: TournamentHighlights } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & TournamentHighlights>(`/api/game/cs2/tournaments/${tournamentId}/highlights`)
      .then((res) => !cancelled && setData({ id: tournamentId, h: res }))
      .catch(() => !cancelled && setData({ id: tournamentId, h: { reel: null, plays: [], matches: [] } }));
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);
  return data?.id === tournamentId ? data.h : null;
}

/**
 * The big card at the top: the tournament reel once it is made, else the
 * best play so far. Links to its watch page.
 */
function Hero({ h, tournamentId, height }: { h: TournamentHighlights; tournamentId: number; height: number | object }) {
  const { t } = useModuleTranslation('cs2');
  const reel = h.reel?.video ? h.reel : null;
  const top = h.plays[0] ?? null;
  if (!reel && !top) return null;
  const players = new Set((reel?.chapters ?? []).map((c) => c.playerId)).size;
  const to = reel ? watchTournamentReelPath(tournamentId) : watchClipPath(top!.id);
  return (
    <Box
      component={RouterLink}
      to={to}
      data-testid="cs2-tournament-reel-hero"
      sx={{
        position: 'relative',
        display: 'block',
        height,
        borderRadius: '22px',
        overflow: 'hidden',
        border: `1px solid ${tokens.color.rule}`,
        color: tokens.color.ink,
        textDecoration: 'none',
        bgcolor: '#000',
        '&:hover .hero-play': { transform: 'scale(1.04)' },
        '&:focus-visible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
      }}
    >
      <VideoThumb src={reel ? reel.video! : top!.video!} at={reel ? 6 : thumbAt(top!.markers)} />
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(16,9,8,0.92) 0%, rgba(16,9,8,0.55) 45%, rgba(16,9,8,0) 75%)' }} />
      <Box
        sx={{
          position: 'absolute',
          left: { xs: 20, md: 40 },
          top: { xs: 20, md: 40 },
          bottom: { xs: 20, md: 40 },
          maxWidth: 440,
          right: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 1.5,
        }}
      >
        <Box sx={{ ...mono, fontSize: '0.8125rem', color: tokens.color.accent }}>
          {reel
            ? [t('highlights.tournament.reel'), reel.duration ? clock(reel.duration) : null].filter(Boolean).join(' · ')
            : t('highlights.tournament.topSoFar')}
        </Box>
        <Box sx={{ fontFamily: fontDisplay, fontSize: { xs: '1.5rem', md: '2.25rem' }, fontWeight: 700, lineHeight: 1.1 }}>
          {reel ? t('highlights.tournament.reelTitle') : `${top!.playerName} · ${playTitle(top!.title)}`}
        </Box>
        <Box sx={{ fontSize: '0.9375rem', color: tokens.color.ink2 }}>
          {reel
            ? t('highlights.tournament.reelSub', { plays: reel.chapters.length, players })
            : [teamsLabel(top!.match), mapLabel(t, top!.map, top!.mapNumber)].filter(Boolean).join(' · ')}
        </Box>
        <Box
          className="hero-play"
          sx={{
            mt: 1,
            alignSelf: 'flex-start',
            height: 48,
            px: 2.75,
            borderRadius: radii.pill,
            bgcolor: tokens.color.accent,
            color: tokens.color.accentInk,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            fontWeight: 600,
            transition: 'transform 150ms',
          }}
        >
          <PlayIcon size={16} weight="fill" />
          {t('highlights.tournament.watch')}
        </Box>
      </Box>
    </Box>
  );
}

const PLAY_FILTERS: HighlightFilter[] = ['all', 'multi', 'clutch', 'flair', 'funny'];
const SHOWN = 8;

/**
 * The tournament page's Highlights tab (the drafts' tournament board): the
 * tournament reel, its top plays with filters, and each match's reels with
 * how far the recording got. With `probe` it only says whether there is any.
 */
export function TournamentHighlightsTab({ tournamentId, probe, onAvailability }: TournamentTabProps) {
  const { t } = useModuleTranslation('cs2');
  const h = useTournamentHighlights(tournamentId);
  const [filter, setFilter] = useState<HighlightFilter>('all');
  const [all, setAll] = useState(false);
  const any = !!h && (h.plays.length > 0 || h.matches.length > 0 || !!h.reel?.video);
  useEffect(() => {
    if (probe && h) onAvailability?.(any);
  }, [probe, h, any, onAvailability]);
  if (probe || !h) return null;
  if (!any) {
    return (
      <Box sx={{ p: 3, borderRadius: '18px', border: `1px dashed ${tokens.color.rule}`, color: tokens.color.muted }}>
        {t('highlights.tournament.none')}
      </Box>
    );
  }
  const plays = h.plays.filter((c) => inFilter(c, filter));
  const shown = all ? plays : plays.slice(0, SHOWN);
  const playSub = (c: Clip) => [teamsLabel(c.match), mapLabel(t, c.map, c.mapNumber), t('highlights.roundN', { n: c.round })].filter(Boolean).join(' · ');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="cs2-tournament-highlights">
      <Hero h={h} tournamentId={tournamentId} height={{ xs: 260, md: 400 }} />

      {h.plays.length > 0 && (
        <Box component="section" aria-labelledby="hl-top-plays">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
            <Box id="hl-top-plays" component="h2" sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}>
              {t('highlights.tournament.topPlays')}
            </Box>
            <Box role="group" aria-label={t('highlights.filterLabel')} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {PLAY_FILTERS.map((f) => (
                <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
                  {t(`highlights.filter.${f}`)}
                </Chip>
              ))}
            </Box>
          </Box>
          {shown.length === 0 ? (
            <Box sx={{ p: 3, borderRadius: '18px', border: `1px dashed ${tokens.color.rule}`, color: tokens.color.muted }}>
              {t('highlights.noneForFilter')}
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))', md: 'repeat(4, minmax(0,1fr))' }, gap: 1.5 }}>
              {shown.map((c) => (
                <HighlightCard
                  key={c.id}
                  testId="cs2-tournament-play"
                  to={watchClipPath(c.id)}
                  video={c.video}
                  markers={c.markers}
                  title={c.playerName}
                  sub={playSub(c)}
                  badge={<KindBadge kind={c.kind} clutch={c.clutch} />}
                  duration={c.markers?.duration}
                />
              ))}
            </Box>
          )}
          {plays.length > SHOWN && (
            <ButtonBase
              onClick={() => setAll(!all)}
              sx={{ mt: 1.5, height: 40, px: 2, borderRadius: radii.pill, border: `1px solid ${tokens.color.rule}`, color: tokens.color.ink2, fontSize: textSize.sm }}
            >
              {all ? t('highlights.showFewer') : t('highlights.showAll', { count: plays.length })}
            </ButtonBase>
          )}
        </Box>
      )}

      {h.matches.length > 0 && (
        <Box component="section" aria-labelledby="hl-match-reels">
          <Box id="hl-match-reels" component="h2" sx={{ m: 0, mb: 1.5, fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}>
            {t('highlights.tournament.matchReels')}
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, borderRadius: '18px', border: `1px solid ${tokens.color.rule}`, bgcolor: tokens.color.paper2, overflow: 'hidden' }}>
            {h.matches.map((m, i) => {
              const done = m.reels.filter((r) => r.video);
              return (
                <Box
                  component="li"
                  key={m.slug}
                  data-testid="cs2-tournament-match-reels"
                  sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderTop: i ? `1px solid ${tokens.color.rule}` : 'none', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
                >
                  <Box sx={{ position: 'relative', width: 120, flex: 'none', aspectRatio: '16 / 9', borderRadius: '8px', overflow: 'hidden', bgcolor: tokens.color.paper3, display: 'grid', placeItems: 'center', color: tokens.color.muted, fontSize: '0.75rem' }}>
                    {done[0]?.video ? <VideoThumb src={done[0].video} at={2} /> : t('highlights.recording')}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    <Box sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {[t('highlights.roundN', { n: m.round }), teamsLabel(m)].filter(Boolean).join(' · ')}
                    </Box>
                    <Box sx={{ fontSize: '0.8125rem', color: tokens.color.muted }}>
                      {m.recording
                        ? t('highlights.tournament.progress', { done: m.playersDone, total: m.playersTotal })
                        : t('highlights.tournament.players', { count: m.playersTotal })}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {done.map((r) => (
                      <Box
                        key={r.mapNumber}
                        component={RouterLink}
                        to={watchMatchReelPath(m.slug, r.mapNumber)}
                        sx={{
                          height: 36,
                          px: 1.5,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.75,
                          borderRadius: radii.pill,
                          border: `1px solid ${tokens.color.rule}`,
                          color: tokens.color.ink2,
                          textDecoration: 'none',
                          fontSize: '0.8125rem',
                          whiteSpace: 'nowrap',
                          '&:hover': { color: tokens.color.ink, borderColor: tokens.color.ink2 },
                          '&:focus-visible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
                        }}
                      >
                        <PlayIcon size={12} weight="fill" />
                        {mapLabel(t, r.map, r.mapNumber)}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * At the top of a finished tournament's results (the drafts' "front page
 * once it's over"): the tournament reel, and its play of the tournament.
 * Nothing until there is either.
 */
export function TournamentReelSection({ tournamentId }: TournamentResultsSectionProps) {
  const { t } = useModuleTranslation('cs2');
  const h = useTournamentHighlights(tournamentId);
  if (!h || (!h.reel?.video && h.plays.length === 0)) return null;
  // Without the reel yet, the hero is the top play itself: no card beside it.
  const top = h.reel?.video ? (h.plays[0] ?? null) : null;
  return (
    <Box
      component="section"
      aria-label={t('highlights.title')}
      sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: top ? 'minmax(0,1.7fr) minmax(0,1fr)' : 'minmax(0,1fr)' }, gap: 2 }}
    >
      <Hero h={h} tournamentId={tournamentId} height={{ xs: 240, md: 340 }} />
      {top && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <SectionHead title={t('highlights.tournament.playOfTheTournament')} level={2} sx={{ mb: 0 }} />
          <HighlightCard
            to={watchClipPath(top.id)}
            video={top.video}
            markers={top.markers}
            title={`${top.playerName} · ${playTitle(top.title)}`}
            sub={[teamsLabel(top.match), mapLabel(t, top.map, top.mapNumber)].filter(Boolean).join(' · ')}
            badge={<KindBadge kind={top.kind} clutch={top.clutch} />}
            duration={top.markers?.duration}
          />
        </Box>
      )}
    </Box>
  );
}
