import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Pagination from '@mui/material/Pagination';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Panel, Row, RowList, SectionHead } from '../../common/ui';
import { InRowLink, OpponentName, RowCoverLink } from '../../team/MatchRowLinks';
import { Link as RouterLink } from 'react-router-dom';
import { matchPagePath, paths, tournamentTabPath } from '../../../paths';
import { mono, textSize, tokens } from '../../../theme/tokens';
import { mapLabel, prettyMap, type ProfileMatch } from './profileMatch';
import { RatingByMonth, type MonthRatingEntry } from './ProfileRatingByMonth';

const PAGE = 10;

/**
 * The profile's Matches tab: the rating month by month (the site has no
 * seasons; a month is one), then every match with filters and pages.
 */
export type { MonthRatingEntry };

export function ProfileMatchesTab({
  matches,
  ratingHistory,
  showStats,
  leaderboardTournamentId = null,
}: {
  /** Newest first. */
  matches: ProfileMatch[];
  ratingHistory: MonthRatingEntry[];
  /** The game measures kills, ADR and the like (CS2 does). */
  showStats: boolean;
  /** The latest tournament's leaderboard, linked beside the list. */
  leaderboardTournamentId?: number | null;
}) {
  return (
    <>
      <RatingByMonth history={ratingHistory} />
      <MatchList
        matches={matches}
        showStats={showStats}
        leaderboardTournamentId={leaderboardTournamentId}
      />
    </>
  );
}

function MatchList({
  matches,
  showStats,
  leaderboardTournamentId,
}: {
  matches: ProfileMatch[];
  showStats: boolean;
  leaderboardTournamentId: number | null;
}) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<'all' | 'win' | 'loss'>('all');
  const [map, setMap] = useState('');
  const [event, setEvent] = useState('');
  const [page, setPage] = useState(1);

  const maps = useMemo(
    () =>
      [...new Set(matches.flatMap((m) => m.maps))].sort((a, b) =>
        prettyMap(a).localeCompare(prettyMap(b))
      ),
    [matches]
  );
  const events = useMemo(
    () => [
      ...new Map(
        matches.flatMap((m) =>
          m.tournament ? [[m.tournament.id, m.tournament.name] as const] : []
        )
      ).entries(),
    ],
    [matches]
  );

  const filtered = matches.filter(
    (m) =>
      (result === 'all' || (result === 'win') === m.won) &&
      (!map || m.maps.includes(map)) &&
      (!event || String(m.tournament?.id ?? '') === event)
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);
  const day = (at: number) =>
    new Date(at * 1000).toLocaleDateString(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const cols = showStats
    ? '2.2rem minmax(12rem, 2.4fr) minmax(5rem, 1fr) 6rem 3.5rem 7rem 2.5rem'
    : '2.2rem minmax(12rem, 2.4fr) minmax(5rem, 1fr) 7rem';
  const num = {
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <Box component="section" aria-labelledby="profile-match-list" sx={{ mt: 7 }}>
      <SectionHead
        id="profile-match-list"
        title={t('playerPage.matchList.title', { count: matches.length })}
        action={
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
            {leaderboardTournamentId !== null && (
              <Box
                component={RouterLink}
                to={paths.tournamentLeaderboard.replace(':id', String(leaderboardTournamentId))}
                data-testid="profile-tournament-leaderboard"
                sx={{ fontSize: textSize.sm, color: tokens.color.accent, mr: 1 }}
              >
                {t('playerPage.recentMatches.leaderboard')}
              </Box>
            )}
            <ToggleButtonGroup
              size="small"
              exclusive
              value={result}
              onChange={(_, v) => {
                if (v) {
                  setResult(v);
                  setPage(1);
                }
              }}
              aria-label={t('playerPage.matchList.result')}
            >
              <ToggleButton value="all">{t('playerPage.matchList.all')}</ToggleButton>
              <ToggleButton value="win">{t('playerPage.matchList.wins')}</ToggleButton>
              <ToggleButton value="loss">{t('playerPage.matchList.losses')}</ToggleButton>
            </ToggleButtonGroup>
            {maps.length > 1 && (
              <TextField
                select
                size="small"
                value={map}
                onChange={(e) => {
                  setMap(e.target.value);
                  setPage(1);
                }}
                label={t('playerPage.matchList.map')}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="">{t('playerPage.matchList.allMaps')}</MenuItem>
                {maps.map((m) => (
                  <MenuItem key={m} value={m}>
                    {prettyMap(m)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {events.length > 1 && (
              <TextField
                select
                size="small"
                value={event}
                onChange={(e) => {
                  setEvent(e.target.value);
                  setPage(1);
                }}
                label={t('playerPage.matchList.event')}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">{t('playerPage.matchList.allEvents')}</MenuItem>
                {events.map(([id, name]) => (
                  <MenuItem key={id} value={String(id)}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        }
      />
      {shown.length === 0 ? (
        <Panel sx={{ px: 3, py: 2 }}>
          <Typography variant="body2" color="text.secondary" data-testid="profile-match-list-empty">
            {matches.length === 0
              ? t('playerPage.noMatchesYet')
              : t('playerPage.matchList.noneMatch')}
          </Typography>
        </Panel>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <RowList data-testid="profile-match-list" sx={{ minWidth: showStats ? 760 : 520 }}>
            {shown.map((m) => (
              <Row
                key={m.key}
                columns={cols}
                data-testid={m.slug ? `profile-match-${m.slug}` : 'profile-match-archived'}
                sx={{
                  position: 'relative',
                  py: 1.5,
                  fontSize: textSize.sm,
                  '&:hover': m.slug ? { bgcolor: 'action.hover' } : undefined,
                }}
              >
                {m.slug && (
                  <RowCoverLink
                    to={matchPagePath(m.slug)}
                    label={t('teamProfile.tournaments.openMatch')}
                  />
                )}
                <Box
                  aria-label={
                    m.won ? t('playerPage.matchList.win') : t('playerPage.matchList.loss')
                  }
                  sx={{
                    ...mono,
                    fontWeight: 700,
                    fontSize: textSize.xs,
                    width: 26,
                    height: 26,
                    borderRadius: '7px',
                    display: 'grid',
                    placeItems: 'center',
                    boxSizing: 'border-box',
                    ...(m.won
                      ? { bgcolor: tokens.color.live, color: tokens.color.paper }
                      : { border: `2px solid ${tokens.color.ban}`, color: tokens.color.ban }),
                  }}
                >
                  {m.won ? t('playerPage.win') : t('playerPage.loss')}
                </Box>
                <Box minWidth={0}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    {m.score && (
                      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', mr: 0.75 }}>
                        {m.score[0]} : {m.score[1]}
                      </Box>
                    )}
                    {m.opponent ? (
                      <>
                        {t('teamMatchHistory.vs')}{' '}
                        <OpponentName id={m.opponent.id} name={m.opponent.name} />
                      </>
                    ) : (
                      m.title
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {m.tournament && (
                      <>
                        <InRowLink to={tournamentTabPath(m.tournament.id)}>
                          {m.tournament.name}
                        </InRowLink>
                        {' · '}
                      </>
                    )}
                    {[m.detail, day(m.at)].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <Typography variant="body2" noWrap>
                  {m.maps.length > 0 ? mapLabel(m.maps) : '—'}
                </Typography>
                {showStats && (
                  <Typography variant="body2" sx={num}>
                    {typeof m.kills === 'number'
                      ? `${m.kills} / ${m.deaths ?? 0} / ${m.assists ?? 0}`
                      : '—'}
                  </Typography>
                )}
                {showStats && (
                  <Typography variant="body2" sx={num}>
                    {typeof m.adr === 'number' ? Math.round(m.adr) : '—'}
                  </Typography>
                )}
                <Typography variant="body2" sx={num}>
                  {typeof m.eloAfter === 'number' ? m.eloAfter : '—'}{' '}
                  {typeof m.eloChange === 'number' && m.eloChange !== 0 && (
                    <Box
                      component="span"
                      sx={{
                        fontWeight: 600,
                        color: m.eloChange > 0 ? tokens.color.live : tokens.color.ban,
                      }}
                    >
                      {m.eloChange > 0 ? '+' : '−'}
                      {Math.abs(m.eloChange)}
                    </Box>
                  )}
                </Typography>
                {showStats && (
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    {m.hasDemo && m.slug && (
                      <Tooltip title={t('playerPage.downloadDemo')}>
                        <IconButton
                          size="small"
                          component="a"
                          href={`/api/demos/${m.slug}/download`}
                          download
                          aria-label={t('playerPage.downloadDemo')}
                        >
                          <DownloadSimpleIcon size="1em" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                )}
              </Row>
            ))}
          </RowList>
        </Box>
      )}
      {filtered.length > PAGE && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
            mt: 2,
            flexWrap: 'wrap',
          }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {t('playerPage.matchList.range', {
              from: (current - 1) * PAGE + 1,
              to: Math.min(current * PAGE, filtered.length),
              total: filtered.length,
            })}
          </Typography>
          <Pagination
            count={pages}
            page={current}
            onChange={(_, p) => setPage(p)}
            shape="rounded"
            aria-label={t('playerPage.matchList.pages')}
          />
        </Box>
      )}
    </Box>
  );
}
