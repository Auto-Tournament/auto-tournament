import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, ButtonBase, CircularProgress, Container } from '@mui/material';
import { CaretLeftIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  fontDisplay,
  links,
  mono,
  pageTitle,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import {
  inFilter,
  mapLabel,
  playTitle,
  teamsLabel,
  watchClipPath,
  watchReelPath,
  type HighlightFilter,
  type PlayerHighlights,
} from './data';
import { HighlightCard } from '../../../module-sdk';
import { KindBadge } from './KindBadge';

type Filter = HighlightFilter | 'reels';
const FILTERS: Filter[] = ['all', 'reels', 'multi', 'clutch', 'flair', 'funny'];

/** A filter chip: a toggle button, the pressed one filled. */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={on}
      sx={{
        height: 36,
        px: 1.75,
        borderRadius: radii.pill,
        border: on ? 'none' : `1px solid ${tokens.color.rule}`,
        bgcolor: on ? tokens.color.ink : 'transparent',
        color: on ? tokens.color.paper : tokens.color.ink2,
        fontSize: '0.8125rem',
        fontWeight: on ? 600 : 400,
        whiteSpace: 'nowrap',
        '&:hover': { color: on ? tokens.color.paper : tokens.color.ink },
        '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
      }}
    >
      {children}
    </ButtonBase>
  );
}

/**
 * Every highlight of one player (the drafts' "all highlights" board): their
 * reels, each map's moments one after the other; then every moment, the ones
 * still being recorded last. The player themselves can star one as their
 * favourite, which leads their profile.
 */
export function PlayerHighlightsPage() {
  const { playerId = '' } = useParams();
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [data, setData] = useState<PlayerHighlights | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'best' | 'newest'>('best');

  const load = useCallback(() => {
    api
      .get<{ success: boolean } & PlayerHighlights>(`/api/game/cs2/players/${encodeURIComponent(playerId)}/highlights?all=1`)
      .then((res) => setData(res))
      .catch(() => setFailed(true));
  }, [playerId]);
  useEffect(load, [load]);

  const name = data?.highlights[0]?.playerName ?? playerId;
  useEffect(() => {
    document.title = pageTitle(t('highlights.pageTitle', { name }));
  }, [name, t]);

  const toggleFavourite = async (id: number) => {
    if (!data) return;
    const next = data.favourite === id ? null : id;
    setData({ ...data, favourite: next });
    try {
      await api.put('/api/game/cs2/players/me/highlights/favourite', { highlightId: next });
    } catch (error) {
      setData({ ...data });
      showError(apiErrorMessage(error, t('highlights.favouriteFailed')));
    }
  };

  if (failed) {
    return (
      <Container maxWidth="lg" sx={{ py: 6, color: tokens.color.muted }}>
        {t('highlights.loadFailed')}
      </Container>
    );
  }
  if (!data) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label={t('highlights.loading')} />
      </Container>
    );
  }

  const clips = data.highlights
    .filter((c) => filter === 'all' || filter === 'reels' || inFilter(c, filter))
    .sort((a, b) =>
      a.status !== b.status
        ? (a.status === 'done' ? -1 : 1)
        : sort === 'best'
          ? b.score - a.score
          : b.createdAt - a.createdAt
    );
  const done = data.highlights.filter((c) => c.status === 'done').length;
  const maps = new Set(data.highlights.map((c) => `${c.matchSlug}:${c.mapNumber}`)).size;
  const showReels = (filter === 'all' || filter === 'reels') && data.reels.length > 0;
  const showClips = filter !== 'reels';

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }} data-testid="cs2-player-highlights">
      <Box
        component={RouterLink}
        to={links.playerProfile(playerId)}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: tokens.color.ink2, textDecoration: 'none', fontSize: textSize.sm, mb: 2, '&:hover': { color: tokens.color.ink } }}
      >
        <CaretLeftIcon size={14} />
        {name}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box>
          <Box component="h1" sx={{ m: 0, fontFamily: fontDisplay, fontSize: { xs: '2rem', md: '2.5rem' }, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('highlights.title')}
          </Box>
          <Box sx={{ color: tokens.color.muted, fontSize: textSize.sm, mt: 0.5 }}>
            {t('highlights.summary', { clips: done, reels: data.reels.length, maps })}
          </Box>
        </Box>
        <Box role="group" aria-label={t('highlights.filterLabel')} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
              {t(`highlights.filter.${f}`)}
            </Chip>
          ))}
          <Chip on={false} onClick={() => setSort(sort === 'best' ? 'newest' : 'best')}>
            {t(`highlights.sort.${sort}`)}
          </Chip>
        </Box>
      </Box>

      {showReels && (
        <Box component="section" aria-labelledby="hl-reels" sx={{ mb: 4 }}>
          <Box id="hl-reels" component="h2" sx={{ m: 0, mb: 1.5, ...mono, fontSize: '0.75rem', fontWeight: 500, color: tokens.color.muted, letterSpacing: '0.04em' }}>
            {t('highlights.reelsHeading')}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))', md: 'repeat(3, minmax(0,1fr))' }, gap: 1.5 }}>
            {data.reels.map((r) => (
                <HighlightCard
                  key={`${r.matchSlug}-${r.mapNumber}`}
                  testId="cs2-highlight-reel"
                  to={watchReelPath(r.matchSlug, r.mapNumber, playerId)}
                  video={r.video}
                  title={[mapLabel(t, r.map, r.mapNumber), teamsLabel(r.match)].filter(Boolean).join(' · ')}
                  sub={t('highlights.moments', { count: r.moments })}
                  badge={<KindBadge kind="reel" clutch={false} label={t('highlights.reelBadge')} />}
                />
            ))}
          </Box>
        </Box>
      )}

      {showClips && (
        <Box component="section" aria-labelledby="hl-moments">
          <Box id="hl-moments" component="h2" sx={{ m: 0, mb: 1.5, ...mono, fontSize: '0.75rem', fontWeight: 500, color: tokens.color.muted, letterSpacing: '0.04em' }}>
            {t('highlights.momentsHeading')}
          </Box>
          {clips.length === 0 ? (
            <Box sx={{ p: 3, borderRadius: '18px', border: `1px dashed ${tokens.color.rule}`, color: tokens.color.muted }}>
              {t('highlights.noneForFilter')}
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))', md: 'repeat(3, minmax(0,1fr))' }, gap: 1.5 }}>
              {clips.map((c) => (
                <HighlightCard
                  key={c.id}
                  testId="cs2-highlight"
                  to={watchClipPath(c.id)}
                  video={c.video}
                  markers={c.markers}
                  title={playTitle(c.title)}
                  sub={[mapLabel(t, c.map, c.mapNumber), t('highlights.roundN', { n: c.round }), teamsLabel(c.match)].filter(Boolean).join(' · ')}
                  badge={<KindBadge kind={c.kind} clutch={c.clutch} label={data.favourite === c.id ? t('highlights.favourite') : undefined} />}
                  duration={c.markers ? c.markers.duration : null}
                  waiting={t(c.status === 'recording' ? 'highlights.recording' : 'highlights.pending')}
                  favourite={data.isOwn && c.status === 'done' ? { on: data.favourite === c.id, onToggle: () => void toggleFavourite(c.id) } : undefined}
                />
              ))}
            </Box>
          )}
        </Box>
      )}
    </Container>
  );
}
