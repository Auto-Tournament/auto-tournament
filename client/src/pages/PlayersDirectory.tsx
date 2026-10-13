import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  InputBase,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useGameAccounts } from '../hooks/useGameAccounts';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, PageHead } from '../components/common/ui';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import PlayerSearchResultsModal from '../components/modals/PlayerSearchResultsModal';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { paths, playerProfilePath } from '../paths';
import { tokens, radii, textSize } from '../theme/tokens';

const { color } = tokens;

interface DirectoryPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  currentElo?: number | null;
  matchCount?: number | null;
  createdAt?: number | null;
  teams?: Array<{ id: string; name: string }>;
}

type SortKey = 'name' | 'matches' | 'newest';
const PAGE = 50;

/**
 * Every player on the site (`/browse/players`): a directory to find someone
 * and open their profile. Search by name, Steam ID or team; sort by name,
 * matches played or newest. Rankings are the Leaderboards page's.
 */
export default function PlayersDirectory() {
  const { t } = useTranslation();
  // Steam wording only when a game here identifies players by Steam (CS2).
  const steamContext = useGameAccounts().steam ? 'steam' : undefined;
  const [players, setPlayers] = useState<DirectoryPlayer[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [shown, setShown] = useState(PAGE);
  const navigate = useNavigate();
  // Someone not in the list: look them up on Steam (an ID, a profile link or
  // a custom URL), as the old Find player page did.
  const [lookup, setLookup] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const [results, setResults] = useState<Array<{ id: string; name: string; avatar?: string }>>([]);
  const findOnSteam = async () => {
    const query = search.trim();
    if (!query) return;
    setLookup({ busy: true, error: null });
    try {
      const r = await api.get<{
        success: boolean;
        player?: { id: string; name: string };
        players?: Array<{ id: string; name: string; avatar?: string }>;
        error?: string;
        steamApiConfigured?: boolean;
      }>(`/api/players/find?query=${encodeURIComponent(query)}`);
      const found = r.player ? [r.player] : (r.players ?? []);
      if (r.success && found.length === 1) navigate(playerProfilePath(found[0].id));
      else if (r.success && found.length > 1) setResults(found);
      setLookup({
        busy: false,
        error:
          r.success && found.length > 0
            ? null
            : r.steamApiConfigured === false
              ? t('findPlayer.inputErrorSteamNotConfigured')
              : t('findPlayer.inputErrorNotFound', { context: steamContext }),
      });
    } catch {
      setLookup({ busy: false, error: t('findPlayer.searchError') });
    }
  };

  useEffect(() => {
    document.title = pageTitle(t('playersDirectory.title'));
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean; players?: DirectoryPlayer[] }>('/api/players/public-selection')
      .then((res) => {
        if (!cancelled) setPlayers(res.success && Array.isArray(res.players) ? res.players : []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (players ?? []).filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.includes(q) ||
        (p.teams ?? []).some((team) => team.name.toLowerCase().includes(q))
    );
    const by: Record<SortKey, (a: DirectoryPlayer, b: DirectoryPlayer) => number> = {
      matches: (a, b) => (b.matchCount ?? 0) - (a.matchCount ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    };
    return [...list].sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name));
  }, [players, search, sort]);

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="players-directory-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={t('playersDirectory.title')}
          subtitle={players ? t('playersDirectory.count', { count: players.length }) : undefined}
          actions={
            <Box
              component={RouterLink}
              to={paths.leaderboards}
              sx={{ color: color.accent, fontSize: textSize.sm, textDecoration: 'none' }}
              data-testid="players-directory-leaderboards"
            >
              {t('playersDirectory.toLeaderboards')}
            </Box>
          }
          sx={{ mb: 3 }}
        />

        <Box role="search" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          <Box
            sx={{
              flex: '1 1 260px',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              minHeight: 44,
              borderRadius: radii.pill,
              border: `1px solid ${color.rule}`,
              color: color.muted,
            }}
          >
            <MagnifyingGlassIcon size={18} aria-hidden />
            <InputBase
              type="search"
              placeholder={t('playersDirectory.searchPlaceholder', { context: steamContext })}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(PAGE);
                setLookup({ busy: false, error: null });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (rows.length === 1) navigate(playerProfilePath(rows[0].id));
                else if (rows.length === 0 && steamContext) void findOnSteam();
              }}
              inputProps={{
                'aria-label': t('playersDirectory.searchPlaceholder', { context: steamContext }),
              }}
              data-testid="players-directory-search"
              sx={{ flex: 1, minWidth: 0, fontSize: textSize.sm, color: color.ink }}
            />
          </Box>
          <Select
            size="small"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            inputProps={{ 'aria-label': t('playersDirectory.sortLabel') }}
            data-testid="players-directory-sort"
            sx={{ minHeight: 44, borderRadius: radii.pill, minWidth: 180 }}
          >
            <MenuItem value="name">{t('playersDirectory.sort.name')}</MenuItem>
            <MenuItem value="matches">{t('playersDirectory.sort.matches')}</MenuItem>
            <MenuItem value="newest">{t('playersDirectory.sort.newest')}</MenuItem>
          </Select>
        </Box>

        {error ? (
          <Alert severity="error">{t('playersDirectory.loadError')}</Alert>
        ) : !players ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('playersDirectory.loading')} />
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <EmptyPanel
              title={t('playersDirectory.emptyTitle')}
              description={t('playersDirectory.emptyDescription')}
              data-testid="players-directory-empty"
            />
            {search.trim() && steamContext && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  onClick={() => void findOnSteam()}
                  disabled={lookup.busy}
                  data-testid="players-directory-steam"
                >
                  {t('playersDirectory.findOnSteam')}
                </Button>
                {lookup.error && (
                  <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                    {lookup.error}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        ) : (
          <>
            <Box
              component="ul"
              data-testid="players-directory-list"
              sx={{
                listStyle: 'none',
                p: 0,
                m: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
                gap: 1.5,
              }}
            >
              {rows.slice(0, shown).map((p) => (
                <Box component="li" key={p.id} data-testid="players-directory-row">
                  <Box
                    component={RouterLink}
                    to={playerProfilePath(p.id)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      p: 1.5,
                      minWidth: 0,
                      height: '100%',
                      borderRadius: radii.md,
                      border: `1px solid ${color.rule}`,
                      bgcolor: color.paper2,
                      color: 'text.primary',
                      textDecoration: 'none',
                      transition: 'background-color 150ms',
                      '&:hover': { bgcolor: color.paper3 },
                      '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                    }}
                  >
                    <PlayerAvatar
                      id={p.id}
                      name={p.name}
                      avatarUrl={p.avatar ?? undefined}
                      size={40}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap sx={{ fontWeight: 600 }}>
                        {p.name}
                      </Typography>
                      <Typography noWrap sx={{ fontSize: textSize.xs, color: color.muted }}>
                        {[
                          (p.teams ?? []).map((team) => team.name).join(', ') || null,
                          t('playersDirectory.matches', { count: p.matchCount ?? 0 }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
            {rows.length > shown && (
              <Box display="flex" justifyContent="center" mt={2}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  sx={{
                    font: 'inherit',
                    color: color.ink,
                    bgcolor: 'transparent',
                    border: `1px solid ${color.rule}`,
                    borderRadius: radii.pill,
                    px: 3,
                    minHeight: 44,
                    cursor: 'pointer',
                    '&:hover': { borderColor: color.ink2 },
                    '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                  }}
                >
                  {t('playersDirectory.showMore', { count: rows.length - shown })}
                </Box>
              </Box>
            )}
          </>
        )}
        <PlayerSearchResultsModal
          open={results.length > 0}
          players={results}
          onClose={() => setResults([])}
        />
      </Container>
    </Box>
  );
}
