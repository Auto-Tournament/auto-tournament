import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { GameMark } from '../components/common/GameMark';
import { PageHead, Row, RowList } from '../components/common/ui';
import { useTournamentList, type TournamentSummary } from '../hooks/useTournamentList';
import { MATCH_FORMATS } from '../constants/tournament';

/** "bo3" -> "Bo3" */
function formatBadge(format: string): string {
  return format.length >= 2 ? format[0].toUpperCase() + format.slice(1) : format;
}

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

export default function Browse() {
  const { t } = useTranslation();
  const { tournaments, loading, error } = useTournamentList();
  const [search, setSearch] = useState('');
  const [game, setGame] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [where, setWhere] = useState<WhereFilter>('all');

  useEffect(() => {
    document.title = t('browsePage.title');
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tournaments.filter((tour) => {
      if (q && !tour.name.toLowerCase().includes(q) && !(tour.location ?? '').toLowerCase().includes(q)) {
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

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="browse-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead title={t('browsePage.title')} sx={{ mb: 3 }} />

        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
          <TextField
            size="small"
            placeholder={t('browsePage.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="browse-search"
            sx={{ flex: '1 1 16rem', minWidth: 0 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select
              value={game}
              onChange={(e) => setGame(e.target.value)}
              data-testid="browse-filter-game"
              displayEmpty
            >
              <MenuItem value="all">{t('browsePage.filters.allGames')}</MenuItem>
              {gameOptions.map((g) => (
                <MenuItem key={g.slug} value={g.slug} data-testid={`browse-filter-game-${g.slug}`}>
                  {g.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              data-testid="browse-filter-status"
              displayEmpty
            >
              {statusOptions.map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`browsePage.filters.status.${s}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {showWhereFilter && (
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                value={where}
                onChange={(e) => setWhere(e.target.value as WhereFilter)}
                data-testid="browse-filter-where"
                displayEmpty
              >
                <MenuItem value="all">{t('browsePage.filters.where.all')}</MenuItem>
                <MenuItem value="online">{t('browsePage.filters.where.online')}</MenuItem>
                <MenuItem value="lan">{t('browsePage.filters.where.lan')}</MenuItem>
              </Select>
            </FormControl>
          )}
        </Stack>

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Typography color="error">{t('browsePage.loadError')}</Typography>
        ) : filtered.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="browse-empty">
            {t('browsePage.empty')}
          </Typography>
        ) : (
          <RowList data-testid="browse-list">
            {filtered.map((tournament) => (
              <Row key={tournament.id} data-testid={`browse-tournament-${tournament.id}`}>
                <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={36} />
                <Box sx={{ minWidth: 0, flex: '1 1 12rem' }}>
                  <Typography variant="subtitle1" fontWeight={600} noWrap>
                    {tournament.name}
                  </Typography>
                  {tournament.location && (
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {tournament.location}
                    </Typography>
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ flex: '0 0 auto' }}>
                  {[
                    t('browsePage.teamsCount', { count: tournament.teamCount }),
                    t(`tournament.typeSelector.types.${tournament.type}.label`),
                    MATCH_FORMATS.find((f) => f.value === tournament.format)?.label ??
                      formatBadge(tournament.format),
                  ].join(' · ')}
                </Typography>
                <Box sx={{ flex: '0 0 auto' }}>
                  {tournament.isLive ? (
                    <Chip size="small" color="success" label={t('browsePage.status.live')} />
                  ) : tournament.status === 'completed' ? (
                    <Chip size="small" label={t('browsePage.status.finished')} />
                  ) : (
                    <Chip size="small" variant="outlined" label={t('browsePage.status.registrationOpen')} />
                  )}
                </Box>
                <Button
                  component={RouterLink}
                  to={`/tournament/${tournament.id}`}
                  variant={tournament.isLive ? 'outlined' : 'contained'}
                  size="small"
                  data-testid={`browse-action-${tournament.id}`}
                >
                  {tournament.isLive ? t('browsePage.watch') : t('browsePage.view')}
                </Button>
              </Row>
            ))}
          </RowList>
        )}
      </Container>
    </Box>
  );
}
