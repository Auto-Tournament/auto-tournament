/**
 * A few of the library's newest videos for a team, player or match, with a
 * link to all of them in the library (the team page's Highlights).
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { ArrowRightIcon } from '@phosphor-icons/react';
import {
  api,
  HighlightCard,
  REEL_THUMB_AT,
  SectionHead,
  useModuleTranslation,
} from '../../../module-sdk';
import { kindLabel, libraryPath, mapLabel, playTitle } from './data';
import { libraryWatchPath, type LibraryItem } from './HighlightsLibraryPage';

type Filter = { team?: string; player?: string; match?: string };

export function LibraryStrip({
  filter,
  id,
  limit = 6,
}: {
  filter: Filter;
  /** The section's heading id (for aria-labelledby). */
  id: string;
  limit?: number;
}) {
  const { t } = useModuleTranslation('cs2');
  const query = new URLSearchParams(
    Object.entries(filter).flatMap(([k, v]) => (v ? [[k, v]] : []))
  ).toString();
  const [loaded, setLoaded] = useState<{
    query: string;
    items: LibraryItem[];
    total: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: LibraryItem[]; total: number }>(`/api/game/cs2/library?${query}&limit=${limit}`)
      .then((r) => !cancelled && setLoaded({ query, items: r.items, total: r.total }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [query, limit]);

  const data = loaded?.query === query ? loaded : null;
  if (!data || data.items.length === 0) return null;

  return (
    <Box component="section" aria-labelledby={id} data-testid={id}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <SectionHead id={id} title={t('library.teamHighlights')} />
        <Button
          component={RouterLink}
          to={libraryPath(filter)}
          endIcon={<ArrowRightIcon />}
          size="small"
          data-testid={`${id}-all`}
        >
          {t('library.matchHighlights')}
        </Button>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
          gap: 2,
        }}
      >
        {data.items.map((i) => (
          <HighlightCard
            key={i.key}
            to={libraryWatchPath(i)}
            video={i.video}
            at={i.kind === 'clip' ? undefined : REEL_THUMB_AT}
            title={
              i.kind === 'clip'
                ? `${i.playerName ?? ''} · ${playTitle(i.title ?? '')}`
                : i.kind === 'team'
                  ? t('highlights.watch.teamReel', { team: i.teamName ?? '' })
                  : t(`library.kindName.${i.kind}`)
            }
            badge={
              i.kind === 'clip'
                ? kindLabel(t, i.play ?? '', / clutch\b/.test(i.title ?? ''))
                : t(`library.kindName.${i.kind}`)
            }
            sub={[
              i.team1 && i.team2 ? `${i.team1} vs ${i.team2}` : null,
              i.mapNumber !== null ? mapLabel(t, i.map, i.mapNumber) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </Box>
    </Box>
  );
}
