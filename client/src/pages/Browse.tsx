import { pageTitle } from '../utils/pageTitle';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container, InputBase, MenuItem, Select } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { GameMark } from '../components/common/GameMark';
import { EmptyPanel, LiveChip, PageHead, Row, RowList } from '../components/common/ui';
import { useTournamentList, type TournamentSummary } from '../hooks/useTournamentList';
import { useAuth } from '../contexts/AuthContext';
import { paths } from '../paths';
import { formatLine, tournamentAction, tournamentWhen } from '../utils/tournamentSummary';
import { tokens, fontMono, radii, textSize } from '../theme/tokens';

const { color } = tokens;

/**
 * Games offered in the filter. Today's tournament data only ever carries the
 * one CS2 game (see `useTournamentList`'s comment), so the games actually
 * *present* in the list would make this filter a no-op. This mirrors the
 * platform's catalog of common games instead, the same slugs the game picker
 * offers before IGDB search kicks in — 3.1's per-tournament game field
 * replaces this with a filter built purely from what's on screen.
 */
const GAME_FILTER_OPTIONS: Array<{ slug: string; name: string }> = [
  { slug: 'counter-strike-2', name: 'Counter-Strike 2' },
  { slug: 'rocket-league', name: 'Rocket League' },
  { slug: 'chess', name: 'Chess' },
  { slug: 'trackmania', name: 'Trackmania' },
];

type StatusFilter = 'all' | 'live' | 'registration_open' | 'finished';
type WhereFilter = 'all' | 'online' | 'lan';

function statusBucket(tournament: TournamentSummary): StatusFilter {
  if (tournament.isLive) return 'live';
  if (tournament.status === 'completed') return 'finished';
  return 'registration_open';
}

/**
 * The row grid (the draft's `.list li`): mark, name, format, when, action.
 * Below `md` the format, when and action stack under the name.
 */
const ROW_COLUMNS = {
  xs: 'auto minmax(0, 1fr)',
  md: 'auto minmax(0, 2fr) minmax(0, 1.2fr) 10rem auto',
} as const;
const STACKED_CELL_SX = { gridColumn: { xs: 2, md: 'auto' } } as const;

/** A pill filter with its label inline (the draft's `.field`). */
function FilterField({ label, grow, children }: { label?: string; grow?: boolean; children: ReactNode }) {
  return (
    <Box
      component="label"
      sx={{
        flex: grow ? '1 1 16rem' : '0 1 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        px: 1.75,
        py: 0.5,
        border: `1px solid ${color.rule}`,
        borderRadius: radii.pill,
        fontSize: textSize.sm,
        color: color.muted,
        '&:focus-within': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      {label}
      {children}
    </Box>
  );
}

const selectSx = {
  fontSize: textSize.sm,
  color: color.ink,
  '& .MuiSelect-select': { py: 0.5, pr: '1.75rem !important', pl: 0 },
  '& .MuiSelect-select:focus': { bgcolor: 'transparent' },
} as const;

/**
 * Browse ("/browse"): the tournaments this site runs, with search and
 * filters, as the draft's table-like row list.
 *
 * 3.0 hosts one tournament per site (multi-tournament is 3.1), so the list
 * holds that one row or nothing: no invented rows, and an honest empty state
 * with "Create tournament" for an admin while there is none.
 */
export default function Browse() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated: isAdmin } = useAuth();
  const { tournaments, loading, error } = useTournamentList();
  const [search, setSearch] = useState('');
  const [game, setGame] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [where, setWhere] = useState<WhereFilter>('all');

  useEffect(() => {
    document.title = pageTitle(t('browsePage.title'));
  }, [t]);

  const gameOptions = useMemo(() => {
    const present = new Set(tournaments.map((tour) => tour.game).filter(Boolean));
    const extra = GAME_FILTER_OPTIONS.filter((g) => !present.has(g.slug));
    const presentOptions = GAME_FILTER_OPTIONS.filter((g) => present.has(g.slug));
    return [...presentOptions, ...extra];
  }, [tournaments]);

  const statusOptions = useMemo(() => {
    const present = new Set(tournaments.map(statusBucket));
    const options: StatusFilter[] = ['all'];
    if (present.has('live')) options.push('live');
    if (present.has('registration_open')) options.push('registration_open');
    if (present.has('finished')) options.push('finished');
    return options;
  }, [tournaments]);

  const showWhereFilter = useMemo(() => tournaments.some((tour) => !!tour.location), [tournaments]);
  const filtersActive =
    search.trim() !== '' || game !== 'all' || status !== 'all' || (showWhereFilter && where !== 'all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tournaments.filter((tour) => {
      if (
        q &&
        !tour.name.toLowerCase().includes(q) &&
        !(tour.location ?? '').toLowerCase().includes(q) &&
        !(tour.organizer ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (game !== 'all' && tour.game !== game) return false;
      if (status !== 'all' && statusBucket(tour) !== status) return false;
      if (showWhereFilter && where !== 'all') {
        const isLan = !!tour.location;
        if (where === 'lan' && !isLan) return false;
        if (where === 'online' && isLan) return false;
      }
      return true;
    });
  }, [tournaments, search, game, status, where, showWhereFilter]);

  const clearFilters = () => {
    setSearch('');
    setGame('all');
    setStatus('all');
    setWhere('all');
  };

  // One tournament per site in 3.0: an admin can create it only while none exists.
  const canCreate = isAdmin && !loading && !error && tournaments.length === 0;
  const hasTournaments = !loading && !error && tournaments.length > 0;

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="browse-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={t('browsePage.title')}
          sx={{ mb: 3 }}
          actions={
            canCreate ? (
              <Button
                component={RouterLink}
                to={paths.tournament}
                variant="outlined"
                data-testid="browse-create-tournament"
              >
                {t('browsePage.createTournament')}
              </Button>
            ) : undefined
          }
        />

        {hasTournaments && (
          <Box role="search" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
            <FilterField grow>
              <SearchIcon sx={{ fontSize: 18 }} aria-hidden />
              <InputBase
                type="search"
                placeholder={t('browsePage.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="browse-search"
                inputProps={{ 'aria-label': t('browsePage.searchLabel') }}
                sx={{ flex: 1, minWidth: 0, fontSize: textSize.sm, color: color.ink }}
              />
            </FilterField>
            <FilterField label={t('browsePage.filters.gameLabel')}>
              <Select
                variant="standard"
                disableUnderline
                value={game}
                onChange={(e) => setGame(e.target.value)}
                data-testid="browse-filter-game"
                sx={selectSx}
              >
                <MenuItem value="all">{t('browsePage.filters.allGames')}</MenuItem>
                {gameOptions.map((g) => (
                  <MenuItem key={g.slug} value={g.slug} data-testid={`browse-filter-game-${g.slug}`}>
                    {g.name}
                  </MenuItem>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t('browsePage.filters.statusLabel')}>
              <Select
                variant="standard"
                disableUnderline
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                data-testid="browse-filter-status"
                sx={selectSx}
              >
                {statusOptions.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`browsePage.filters.status.${s}`)}
                  </MenuItem>
                ))}
              </Select>
            </FilterField>
            {showWhereFilter && (
              <FilterField label={t('browsePage.filters.whereLabel')}>
                <Select
                  variant="standard"
                  disableUnderline
                  value={where}
                  onChange={(e) => setWhere(e.target.value as WhereFilter)}
                  data-testid="browse-filter-where"
                  sx={selectSx}
                >
                  <MenuItem value="all">{t('browsePage.filters.where.all')}</MenuItem>
                  <MenuItem value="online">{t('browsePage.filters.where.online')}</MenuItem>
                  <MenuItem value="lan">{t('browsePage.filters.where.lan')}</MenuItem>
                </Select>
              </FilterField>
            )}
          </Box>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('browsePage.loading')} />
          </Box>
        ) : error ? (
          <Alert severity="error">{t('browsePage.loadError')}</Alert>
        ) : tournaments.length === 0 ? (
          <EmptyPanel
            title={t('browsePage.emptyNone.title')}
            description={
              isAdmin ? t('browsePage.emptyNone.descriptionAdmin') : t('browsePage.emptyNone.description')
            }
            data-testid="browse-empty"
          />
        ) : filtered.length === 0 ? (
          <EmptyPanel
            title={t('browsePage.emptyFiltered.title')}
            description={t('browsePage.emptyFiltered.description')}
            data-testid="browse-empty"
          >
            {filtersActive && (
              <Button variant="outlined" size="small" onClick={clearFilters} data-testid="browse-clear-filters">
                {t('browsePage.emptyFiltered.clear')}
              </Button>
            )}
          </EmptyPanel>
        ) : (
          <RowList data-testid="browse-list" aria-label={t('browsePage.listLabel')}>
            <Row
              columns={ROW_COLUMNS}
              aria-hidden
              sx={{
                display: { xs: 'none', md: 'grid' },
                py: 1.5,
                fontFamily: fontMono,
                fontSize: textSize.xs,
                fontWeight: 500,
                lineHeight: 1,
                color: color.muted,
                textTransform: 'uppercase',
              }}
            >
              <span />
              <span>{t('browsePage.columns.tournament')}</span>
              <span>{t('browsePage.columns.format')}</span>
              <span>{t('browsePage.columns.when')}</span>
              <span />
            </Row>
            {filtered.map((tournament) => {
              const when = tournamentWhen(t, tournament, i18n.language);
              const action = tournamentAction(tournament);
              const byline = [tournament.organizer, tournament.location].filter(Boolean).join(' · ');
              return (
                <Row
                  key={tournament.id}
                  columns={ROW_COLUMNS}
                  data-testid={`browse-tournament-${tournament.id}`}
                >
                  <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={36} />
                  <Box sx={{ minWidth: 0 }}>
                    <Box component="b" sx={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {tournament.name}
                    </Box>
                    {byline && (
                      <Box component="small" sx={{ display: 'block', color: color.muted, fontSize: textSize.xs }}>
                        {byline}
                      </Box>
                    )}
                  </Box>
                  <Box
                    component="span"
                    data-testid={`browse-format-${tournament.id}`}
                    sx={[STACKED_CELL_SX, { fontSize: textSize.sm, color: color.ink2 }]}
                  >
                    {formatLine(t, tournament)}
                  </Box>
                  <Box
                    component="span"
                    data-testid={`browse-when-${tournament.id}`}
                    sx={[
                      STACKED_CELL_SX,
                      {
                        fontSize: textSize.sm,
                        fontVariantNumeric: 'tabular-nums',
                        color: when.kind === 'text' && when.muted ? color.muted : color.ink,
                      },
                    ]}
                  >
                    {when.kind === 'live' ? <LiveChip label={t('browsePage.status.live')} /> : when.text}
                  </Box>
                  <Box sx={[STACKED_CELL_SX, { justifySelf: 'start' }]}>
                    <Button
                      component={RouterLink}
                      to={action.to}
                      variant={action.primary ? 'contained' : 'outlined'}
                      size="small"
                      data-testid={`browse-action-${tournament.id}`}
                    >
                      {t(`browsePage.actions.${action.key}`)}
                    </Button>
                  </Box>
                </Row>
              );
            })}
          </RowList>
        )}
      </Container>
    </Box>
  );
}
