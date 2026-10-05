import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container, InputBase, MenuItem, Select, Typography } from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, PageHead, Row, RowList } from '../components/common/ui';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { playerProfilePath } from '../paths';
import { tokens, fontMono, radii, textSize } from '../theme/tokens';

const { color } = tokens;

interface DirectoryPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  currentElo?: number | null;
  matchCount?: number | null;
  createdAt?: number | null;
}

type SortKey = 'rating' | 'matches' | 'name' | 'newest';
const PAGE = 50;

/**
 * Every player on the site (`/browse/players`): search by name or Steam ID,
 * sort by rating, matches played, name or newest, and open a profile.
 */
export default function PlayersDirectory() {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<DirectoryPlayer[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('rating');
  const [shown, setShown] = useState(PAGE);

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
      (p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q)
    );
    const by: Record<SortKey, (a: DirectoryPlayer, b: DirectoryPlayer) => number> = {
      rating: (a, b) => (b.currentElo ?? 0) - (a.currentElo ?? 0),
      matches: (a, b) => (b.matchCount ?? 0) - (a.matchCount ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    };
    return [...list].sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name));
  }, [players, search, sort]);

  const columns = 'minmax(0, 1fr) 6rem 6rem';

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="players-directory-page">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={t('playersDirectory.title')}
          subtitle={players ? t('playersDirectory.count', { count: players.length }) : undefined}
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
              placeholder={t('playersDirectory.searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(PAGE);
              }}
              inputProps={{ 'aria-label': t('playersDirectory.searchPlaceholder') }}
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
            <MenuItem value="rating">{t('playersDirectory.sort.rating')}</MenuItem>
            <MenuItem value="matches">{t('playersDirectory.sort.matches')}</MenuItem>
            <MenuItem value="name">{t('playersDirectory.sort.name')}</MenuItem>
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
          <EmptyPanel
            title={t('playersDirectory.emptyTitle')}
            description={t('playersDirectory.emptyDescription')}
            data-testid="players-directory-empty"
          />
        ) : (
          <>
            <RowList data-testid="players-directory-list">
              <Row columns={columns} sx={{ py: 1.25 }} aria-hidden>
                <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}>
                  {t('playersDirectory.columns.player')}
                </Typography>
                <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted, textAlign: 'right' }}>
                  {t('playersDirectory.columns.rating')}
                </Typography>
                <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted, textAlign: 'right' }}>
                  {t('playersDirectory.columns.matches')}
                </Typography>
              </Row>
              {rows.slice(0, shown).map((p, i) => (
                <Row key={p.id} columns={columns} data-testid="players-directory-row">
                  <Box
                    component={RouterLink}
                    to={playerProfilePath(p.id)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      minWidth: 0,
                      color: 'text.primary',
                      textDecoration: 'none',
                      '&:hover .name': { textDecoration: 'underline' },
                    }}
                  >
                    {sort === 'rating' && !search && (
                      <Typography
                        component="span"
                        sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted, width: '2.5ch', flex: 'none' }}
                      >
                        {i + 1}
                      </Typography>
                    )}
                    <PlayerAvatar id={p.id} name={p.name} avatarUrl={p.avatar ?? undefined} size={32} />
                    <Typography className="name" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                      {p.name}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontFamily: fontMono, textAlign: 'right' }}>
                    {typeof p.currentElo === 'number' ? Math.round(p.currentElo) : '—'}
                  </Typography>
                  <Typography sx={{ fontFamily: fontMono, textAlign: 'right', color: color.ink2 }}>
                    {p.matchCount ?? 0}
                  </Typography>
                </Row>
              ))}
            </RowList>
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
      </Container>
    </Box>
  );
}
