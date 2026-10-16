import { useState, type MouseEvent } from 'react';
import { fmtTime, fmtWeekdayTime } from '../utils/time';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { matchPagePath } from '../paths';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { TabEmpty, TabError, TabLoading } from '../components/tournament/page/TabState';
import {
  isLiveMatch,
  isUpcomingMatch,
  publicMatchLabel,
  seriesScore,
} from '../components/tournament/page/matchHelpers';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { compareMatchOrder } from '../utils/matchUtils';
import { getMapData, getMapDisplayName } from '../constants/maps';
import type { Match, Tournament } from '../types';
import { tokens, fontDisplay, mono, textSize, withAlpha } from '../theme/tokens';
import { StatePill, TeamIdentity, resultInk, YoursPill } from '../components/tournament/ui/draftUi';
import { SegmentedControl } from '../components/common/SegmentedControl';

const { color } = tokens;

type Filter = 'all' | 'live' | 'upcoming' | 'mine';

const mapOf = (m: Match): string | null =>
  m.currentMap ?? m.mapResults?.[0]?.mapName ?? m.maps?.[0] ?? null;

/** The score a card shows: rounds for one map, maps won for a series. */
function cardScore(m: Match): [number, number] | null {
  const done = m.status === 'completed';
  if (!done && !isLiveMatch(m)) return null;
  if (done && m.mapResults?.length === 1)
    return [m.mapResults[0].team1Score, m.mapResults[0].team2Score];
  if (
    !done &&
    (m.team1MapScore ?? null) !== null &&
    (m.team1SeriesScore ?? 0) + (m.team2SeriesScore ?? 0) === 0
  ) {
    return [m.team1MapScore ?? 0, m.team2MapScore ?? 0];
  }
  const s = seriesScore(m);
  return [s.team1, s.team2];
}

/** One match as a card (the drafts' Matches tab): the map behind, logos, a big score. */
function MatchCard({
  match,
  tournament,
  viewerTeamId,
}: {
  match: Match;
  tournament: Tournament;
  viewerTeamId: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const done = match.status === 'completed';
  const live = isLiveMatch(match);
  const score = cardScore(match);
  const map = mapOf(match);
  const image = map ? getMapData(map)?.thumbnail : undefined;
  const mine =
    !!viewerTeamId && (match.team1?.id === viewerTeamId || match.team2?.id === viewerTeamId);
  const winner = match.winner?.id;
  const ink = (id?: string) =>
    resultInk({ teamId: id, winnerId: winner, done, yourTeamId: viewerTeamId });
  const overtime =
    done && (match.mapResults ?? []).some((r) => Math.max(r.team1Score, r.team2Score) > 13);
  const foot =
    live && match.team1MapScore !== null && match.team1MapScore !== undefined
      ? t('liveOverview.round', { n: (match.team1MapScore ?? 0) + (match.team2MapScore ?? 0) + 1 })
      : overtime
        ? t('matchesCards.afterOvertime')
        : '';

  const side = (s: 'team1' | 'team2') => {
    const team = match[s];
    return (
      <TeamIdentity
        team={team ? { id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl } : null}
        size="lg"
        layout="column"
        yours={ink(team?.id).yours}
        nameOnPhone={false}
        nameSx={{ fontSize: '0.9375rem' }}
        tbd={t('overviewPage.yourTeam.tbd')}
      />
    );
  };

  return (
    <Box
      data-testid={`public-match-${match.slug}`}
      onClick={(e: MouseEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).closest('a')) return;
        navigate(matchPagePath(match.slug));
      }}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '20px',

        aspectRatio: '4 / 3',
        maxWidth: '100%',
        bgcolor: color.paper2,
        cursor: 'pointer',
        '&:hover': { filter: 'brightness(1.12)' },
      }}
    >
      {image && (
        <Box
          component="img"
          src={image}
          alt=""
          loading="lazy"
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: `linear-gradient(to top, ${withAlpha(color.paper, 0.94)}, ${withAlpha(color.paper, 0.55)} 55%, ${withAlpha(color.paper, 0.25)})`,
        }}
      >
        <Box
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
        >
          <Box
            component={RouterLink}
            to={matchPagePath(match.slug)}
            data-testid={`public-match-link-${match.slug}`}
            sx={{
              fontSize: textSize.sm,
              color: color.ink2,
              textDecoration: 'none',
              '&:hover': { color: color.ink },
            }}
          >
            {publicMatchLabel(match, tournament)}
            {map ? ` · ${getMapDisplayName(map)}` : ''}
          </Box>
          {/* Yours: said in words (an outline needed a legend). */}
          {mine && (
            <YoursPill
              kind="match"
              testId={`public-match-mine-${match.slug}`}
              sx={{ ml: 'auto' }}
            />
          )}
          <StatePill
            state={live ? 'live' : done ? 'done' : 'upcoming'}
            label={
              live
                ? t('liveOverview.state.live')
                : done
                  ? t('matchesCards.done')
                  : match.startsAt && match.vetoOpensAt
                    ? t('matchesCards.startsAt', {
                        time: fmtTime(match.startsAt),
                        veto: fmtTime(match.vetoOpensAt),
                      })
                    : t('liveOverview.state.upcoming')
            }
          />
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          {side('team1')}
          <Typography component="span" sx={{ ...mono, fontSize: '2.125rem', whiteSpace: 'nowrap' }}>
            {score ? (
              <>
                <Box component="span" sx={{ color: ink(match.team1?.id).score }}>
                  {score[0]}
                </Box>
                <Box component="span" sx={{ color: color.muted }}>
                  {' – '}
                </Box>
                <Box component="span" sx={{ color: ink(match.team2?.id).score }}>
                  {score[1]}
                </Box>
              </>
            ) : (
              <Box
                component="span"
                sx={{ color: color.muted, fontSize: '1.25rem', fontFamily: fontDisplay }}
              >
                {t('overviewPage.matchesTab.vs')}
              </Box>
            )}
          </Typography>
          {side('team2')}
        </Box>
        <Typography
          sx={{ fontSize: textSize.sm, color: color.ink2, textAlign: 'center', minHeight: '1lh' }}
        >
          {foot}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * The tournament page's Matches tab (the drafts' match cards): filters on
 * top, then the rounds as grids of cards: live first, then the next ones, then results. A card opens its
 * match room; a team name opens the team.
 */
export default function TournamentMatchesTab() {
  const { t } = useTranslation();
  const { tournament, viewerTeam } = useTournamentPage();
  const { matches, loading, error } = usePublicBracket(tournament.id);
  const [filter, setFilter] = useState<Filter>('all');

  if (loading) return <TabLoading label={t('overviewPage.loading')} />;
  if (error) return <TabError message={t('overviewPage.matchesTab.loadError')} />;

  const shown = matches.filter(
    (m) => m.status === 'completed' || isLiveMatch(m) || isUpcomingMatch(m)
  );
  // The schedule's first entry: "Matches appear here when the tournament starts: Saturday 12:00."
  const firstAt = tournament.settings?.schedule?.[0]?.at
    ? new Date(tournament.settings.schedule[0].at)
    : null;
  if (shown.length === 0) {
    return (
      <TabEmpty
        title={t('overviewPage.matchesTab.emptyTitle')}
        description={
          firstAt
            ? t('overviewPage.matchesTab.emptyDescriptionAt', {
                when: fmtWeekdayTime(firstAt),
              })
            : t('overviewPage.matchesTab.emptyDescription')
        }
        data-testid="public-matches-empty"
      />
    );
  }

  const viewerTeamId = viewerTeam?.id ?? null;
  const mine = (m: Match) =>
    !!viewerTeamId && (m.team1?.id === viewerTeamId || m.team2?.id === viewerTeamId);
  const pass = (m: Match, f: Filter) =>
    f === 'all'
      ? true
      : f === 'live'
        ? isLiveMatch(m)
        : f === 'upcoming'
          ? isUpcomingMatch(m)
          : mine(m);
  const count = (f: Filter) => shown.filter((m) => pass(m, f)).length;

  // Rounds newest first (the final on top); within a round, bracket order.
  const groups = new Map<string, Match[]>();
  for (const m of [...shown].filter((m) => pass(m, filter)).sort(compareMatchOrder)) {
    const key = `${m.round}|${m.bracket ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  // Live rounds first, then what is coming in order, then the results newest first.
  const rank = (list: Match[]) =>
    list.some(isLiveMatch) ? 0 : list.some((m) => m.status !== 'completed') ? 1 : 2;
  const ordered = [...groups.entries()].sort((a, b) => {
    const ra = rank(a[1]);
    const rb = rank(b[1]);
    if (ra !== rb) return ra - rb;
    const na = Number(a[0].split('|')[0]);
    const nb = Number(b[0].split('|')[0]);
    return ra === 2 ? nb - na : na - nb;
  });

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('matchesCards.filterAll', { count: count('all') }) },
    { id: 'live', label: t('matchesCards.filterLive', { count: count('live') }) },
    { id: 'upcoming', label: t('matchesCards.filterUpcoming', { count: count('upcoming') }) },
    ...(viewerTeam ? [{ id: 'mine' as Filter, label: `${viewerTeam.name} ${count('mine')}` }] : []),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="public-matches">
      <SegmentedControl<Filter>
        look="chips"
        label={t('matchesCards.show')}
        value={filter}
        onChange={setFilter}
        options={filters.map((f) => ({ value: f.id, label: f.label }))}
      />
      {ordered.map(([key, list]) => {
        const map = list.map(mapOf).find(Boolean);
        const sameMap = !!map && list.every((m) => !mapOf(m) || mapOf(m) === map);
        const title = publicMatchLabel(list[0], tournament);
        return (
          <Box
            component="section"
            key={key}
            aria-label={title}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'baseline' }}>
              <Typography
                component="h2"
                sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
              >
                {title}
              </Typography>
              {sameMap && (
                <Typography sx={{ fontSize: '0.875rem', color: color.muted }}>
                  {getMapDisplayName(map as string)}
                </Typography>
              )}
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 20rem), 1fr))',
                gap: 2,
              }}
            >
              {list.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  tournament={tournament}
                  viewerTeamId={viewerTeamId}
                />
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
