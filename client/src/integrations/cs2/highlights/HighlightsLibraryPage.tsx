/**
 * The highlights library (`/highlights`): every clip and reel, newest, most
 * viewed or most liked first. `?player=`, `?team=`, `?match=` and
 * `?tournament=` narrow it (the links from profiles, team and match pages),
 * and each video opens its own watch page.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, Container, Stack } from '@mui/material';
import { EyeIcon, FilmSlateIcon, HeartIcon } from '@phosphor-icons/react';
import {
  api,
  EmptyState,
  HighlightCard,
  PageHead,
  pageTitle,
  SegmentedControl,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import {
  kindLabel,
  mapLabel,
  playTitle,
  watchClipPath,
  watchMatchReelPath,
  watchReelPath,
  watchTeamReelPath,
  watchTournamentReelPath,
} from './data';

type Sort = 'new' | 'views' | 'likes';
type Kind = 'all' | 'clips' | 'reels';

/** One video, as `GET /api/game/cs2/library` lists it. */
export interface LibraryItem {
  key: string;
  kind: 'clip' | 'player' | 'map' | 'series' | 'team' | 'tournament';
  video: string;
  play: string | null;
  title: string | null;
  round: number | null;
  matchSlug: string | null;
  mapNumber: number | null;
  map: string | null;
  playerId: string | null;
  playerName: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  team1: string | null;
  team2: string | null;
  tournamentId: number | null;
  tournament: string | null;
  createdAt: number;
  views: number;
  likes: number;
  liked: boolean;
}

/** Where a video is watched. */
export function libraryWatchPath(i: LibraryItem): string {
  switch (i.kind) {
    case 'clip':
      return watchClipPath(Number(i.key.slice('clip/'.length)));
    case 'player':
      return watchReelPath(i.matchSlug!, i.mapNumber!, i.playerId!);
    case 'map':
    case 'series':
      return watchMatchReelPath(i.matchSlug!, i.mapNumber!);
    case 'team':
      return watchTeamReelPath(i.matchSlug!, i.teamId!);
    case 'tournament':
      return watchTournamentReelPath(i.tournamentId!);
  }
}

const PAGE = 24;
const FILTERS = ['player', 'team', 'match', 'tournament'] as const;

export function HighlightsLibraryPage() {
  const { t } = useModuleTranslation('cs2');
  const [search, setSearch] = useSearchParams();
  const sort = (['new', 'views', 'likes'] as const).find((s) => s === search.get('sort')) ?? 'new';
  const kind = (['all', 'clips', 'reels'] as const).find((s) => s === search.get('kind')) ?? 'all';
  const filters = FILTERS.flatMap((f) => (search.get(f) ? [[f, search.get(f)!] as const] : []));
  const filterKey = filters.map(([f, v]) => `${f}=${v}`).join('&');

  const [page, setPage] = useState(1);
  // The answer for the last page asked for (`key`), with every page so far.
  const [result, setResult] = useState<{
    key: string;
    items: LibraryItem[];
    total: number;
    failed: boolean;
  }>({ key: '', items: [], total: 0, failed: false });

  useEffect(() => {
    document.title = pageTitle(t('library.title'));
  }, [t]);

  // A new sort, kind or filter starts again at the first page.
  const query = `sort=${sort}&kind=${kind}${filterKey ? `&${filterKey}` : ''}`;
  const [shownQuery, setShownQuery] = useState(query);
  if (shownQuery !== query) {
    setShownQuery(query);
    setPage(1);
    setResult((r) => ({ ...r, items: [], total: 0 }));
  }
  const requestKey = `${query}&page=${page}`;

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: LibraryItem[]; total: number }>(
        `/api/game/cs2/library?${requestKey}&limit=${PAGE}`
      )
      .then((r) => {
        if (cancelled) return;
        setResult((prev) => ({
          key: requestKey,
          items: page === 1 ? r.items : [...prev.items, ...r.items],
          total: r.total,
          failed: false,
        }));
      })
      .catch(() => !cancelled && setResult((prev) => ({ ...prev, key: requestKey, failed: true })));
    return () => {
      cancelled = true;
    };
  }, [requestKey, page]);

  const { items, total, failed } = result;
  const loading = result.key !== requestKey;

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(search);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearch(next, { replace: true });
  };

  // What a filter is called: a name from the list when one is on screen.
  const filterLabel = (f: (typeof FILTERS)[number], v: string) => {
    const i = items[0];
    if (f === 'player')
      return t('library.filter.player', { name: i?.playerId === v ? i.playerName : v });
    if (f === 'team')
      return t('library.filter.team', { name: items.find((x) => x.teamId === v)?.teamName ?? v });
    if (f === 'match')
      return t('library.filter.match', {
        name: i && i.matchSlug === v && i.team1 && i.team2 ? `${i.team1} vs ${i.team2}` : v,
      });
    return t('library.filter.tournament', { name: i?.tournament ?? v });
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }} data-testid="highlights-library">
      <PageHead
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        actions={
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <SegmentedControl<Kind>
              label={t('library.kindLabel')}
              value={kind}
              onChange={(v) => set('kind', v === 'all' ? null : v)}
              options={[
                { value: 'all', label: t('library.kind.all') },
                { value: 'clips', label: t('library.kind.clips') },
                { value: 'reels', label: t('library.kind.reels') },
              ]}
              testId="library-kind"
            />
            <SegmentedControl<Sort>
              label={t('library.sortLabel')}
              value={sort}
              onChange={(v) => set('sort', v === 'new' ? null : v)}
              options={[
                { value: 'new', label: t('library.sort.new') },
                { value: 'views', label: t('library.sort.views') },
                { value: 'likes', label: t('library.sort.likes') },
              ]}
              testId="library-sort"
            />
          </Stack>
        }
      />

      {filters.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
          {filters.map(([f, v]) => (
            <Chip
              key={f}
              label={filterLabel(f, v)}
              onDelete={() => set(f, null)}
              data-testid={`library-filter-${f}`}
            />
          ))}
        </Stack>
      )}

      {failed && items.length === 0 ? (
        <EmptyState
          icon={FilmSlateIcon}
          title={t('library.failed')}
          description={t('library.failedHint')}
        />
      ) : !loading && items.length === 0 ? (
        <Box data-testid="library-empty">
          <EmptyState
            icon={FilmSlateIcon}
            title={t(filters.length ? 'library.emptyFiltered' : 'library.empty')}
            description={t(filters.length ? 'library.emptyFilteredHint' : 'library.emptyHint')}
          />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
            gap: 3,
          }}
          data-testid="library-grid"
        >
          {items.map((i) => (
            <HighlightCard
              key={i.key}
              to={libraryWatchPath(i)}
              video={i.video}
              title={titleOf(t, i)}
              badge={badgeOf(t, i)}
              sub={
                <Box component="span" sx={{ display: 'grid', gap: 0.25 }}>
                  <span>{subOf(t, i)}</span>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex',
                      gap: 1.5,
                      color: tokens.color.muted,
                      fontSize: textSize.xs,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                    >
                      <EyeIcon size={14} aria-hidden /> {t('library.views', { count: i.views })}
                    </Box>
                    <Box
                      component="span"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                    >
                      <HeartIcon size={14} weight={i.liked ? 'fill' : 'regular'} aria-hidden />{' '}
                      {t('library.likes', { count: i.likes })}
                    </Box>
                  </Box>
                </Box>
              }
              testId={`library-item-${i.key}`}
            />
          ))}
        </Box>
      )}

      <Box sx={{ display: 'grid', placeItems: 'center', mt: 4 }}>
        {loading ? (
          <CircularProgress size={28} />
        ) : items.length < total ? (
          <Button
            variant="outlined"
            onClick={() => setPage((p) => p + 1)}
            data-testid="library-more"
          >
            {t('library.more', { shown: items.length, total })}
          </Button>
        ) : null}
      </Box>
    </Container>
  );
}

type T = ReturnType<typeof useModuleTranslation>['t'];

function titleOf(t: T, i: LibraryItem): string {
  switch (i.kind) {
    case 'clip':
      return `${i.playerName ?? ''} · ${playTitle(i.title ?? '')}`;
    case 'player':
      return t('library.playerReel', { name: i.playerName ?? '' });
    case 'team':
      return t('highlights.watch.teamReel', { team: i.teamName ?? '' });
    case 'tournament':
      return t('library.tournamentReel', { name: i.tournament ?? '' });
    default:
      return i.team1 && i.team2 ? `${i.team1} vs ${i.team2}` : t('library.matchReel');
  }
}

function subOf(t: T, i: LibraryItem): string {
  const match = i.team1 && i.team2 ? `${i.team1} vs ${i.team2}` : null;
  const map = i.mapNumber !== null ? mapLabel(t, i.map, i.mapNumber) : null;
  const parts =
    i.kind === 'clip'
      ? [match, map, i.round ? t('highlights.roundN', { n: i.round }) : null]
      : i.kind === 'map' || i.kind === 'series'
        ? [map, i.tournament]
        : i.kind === 'tournament'
          ? [t('library.kindName.tournament')]
          : [match, map];
  return parts.filter(Boolean).join(' · ');
}

function badgeOf(t: T, i: LibraryItem): string {
  return i.kind === 'clip'
    ? kindLabel(t, i.play ?? '', / clutch\b/.test(i.title ?? ''))
    : t(`library.kindName.${i.kind}`);
}
