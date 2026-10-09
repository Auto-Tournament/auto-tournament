/**
 * The search box in the top bar: a button (and Ctrl/⌘ K, or "/" outside a
 * text field) that opens a dialog searching players, teams, tournaments and
 * played matches (GET /api/search) and, for admins, the admin pages and
 * settings (search/adminIndex.ts). Arrow keys move, Enter opens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListSubheader,
  Typography,
} from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useInstalledIntegrations } from '../../integrations/registry';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { paths, playerProfilePath } from '../../paths';
import { searchAdminIndex } from '../../search/adminIndex';

interface SearchResults {
  players: Array<{ id: string; name: string; avatar: string | null }>;
  teams: Array<{ id: string; name: string; tag: string | null }>;
  tournaments: Array<{ id: number; name: string; status: string }>;
  matches: Array<{
    slug: string;
    team1: string | null;
    team2: string | null;
    event: string | null;
  }>;
}

interface Hit {
  key: string;
  group: 'pages' | 'players' | 'teams' | 'tournaments' | 'matches';
  label: string;
  detail?: string;
  to: string;
  avatar?: { id: string; name: string; url: string | null };
}

const EMPTY: SearchResults = { players: [], teams: [], tournaments: [], matches: [] };

export function SiteSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated: isAdmin } = useAuth();
  const installed = useInstalledIntegrations();
  const modules = useMemo(() => new Set(installed.map((i) => i.id)), [installed]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  // Ctrl/⌘ K anywhere, "/" outside a text field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (
        (e.key === 'k' && (e.metaKey || e.ctrlKey)) ||
        (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const mine = ++seq.current;
    const id = setTimeout(() => {
      api
        .get<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (mine === seq.current) setResults({ ...EMPTY, ...res });
        })
        .catch(() => null);
    }, 150);
    return () => clearTimeout(id);
  }, [q]);

  const hits: Hit[] = useMemo(() => {
    const query = q.trim();
    if (query.length < 2) return [];
    const out: Hit[] = [];
    if (isAdmin) {
      for (const p of searchAdminIndex(query, (key) => t(`search.pages.${key}`), modules)) {
        out.push({
          key: `page-${p.key}`,
          group: 'pages',
          label: t(`search.pages.${p.key}`),
          to: p.to,
        });
      }
    }
    for (const p of results.players) {
      out.push({
        key: `player-${p.id}`,
        group: 'players',
        label: p.name,
        to: playerProfilePath(p.id),
        avatar: { id: p.id, name: p.name, url: p.avatar },
      });
    }
    for (const team of results.teams) {
      out.push({
        key: `team-${team.id}`,
        group: 'teams',
        label: team.name,
        detail: team.tag ?? undefined,
        to: paths.teamProfile.replace(':teamId', encodeURIComponent(team.id)),
      });
    }
    for (const tour of results.tournaments) {
      out.push({
        key: `tournament-${tour.id}`,
        group: 'tournaments',
        label: tour.name,
        detail: t(`search.status.${tour.status}`, { defaultValue: tour.status }),
        to: paths.tournamentOverview.replace(':id', String(tour.id)),
      });
    }
    for (const m of results.matches) {
      out.push({
        key: `match-${m.slug}`,
        group: 'matches',
        label: m.team1 && m.team2 ? t('search.versus', { team1: m.team1, team2: m.team2 }) : m.slug,
        detail: m.event ?? undefined,
        to: paths.match.replace(':slug', encodeURIComponent(m.slug)),
      });
    }
    return out;
  }, [q, results, isAdmin, modules, t]);

  const close = () => {
    setOpen(false);
    setQ('');
    setResults(EMPTY);
    setActive(0);
  };
  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    close();
    navigate(hit.to);
  };

  const groups = ['pages', 'players', 'teams', 'tournaments', 'matches'] as const;
  const searching = q.trim().length >= 2;

  return (
    <>
      <IconButton
        size="small"
        onClick={() => setOpen(true)}
        aria-label={t('search.open')}
        data-testid="site-search-open"
      >
        <MagnifyingGlassIcon size={20} />
      </IconButton>
      <Dialog
        open={open}
        onClose={close}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { alignSelf: 'flex-start', mt: { xs: 2, sm: 10 } } }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1.25,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <MagnifyingGlassIcon size={20} aria-hidden />
          <InputBase
            autoFocus
            fullWidth
            value={q}
            placeholder={isAdmin ? t('search.placeholderAdmin') : t('search.placeholder')}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(hits[active]);
              }
            }}
            inputProps={{
              'aria-label': t('search.open'),
              'data-testid': 'site-search-input',
              role: 'combobox',
              'aria-expanded': hits.length > 0,
              'aria-controls': 'site-search-results',
            }}
          />
          <ButtonBase
            onClick={close}
            sx={{
              px: 1,
              py: 0.25,
              borderRadius: 1,
              fontSize: 12,
              color: 'text.secondary',
              border: 1,
              borderColor: 'divider',
            }}
          >
            Esc
          </ButtonBase>
        </Box>
        <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {!searching ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {t('search.hint')}
            </Typography>
          ) : hits.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ p: 2 }}
              data-testid="site-search-empty"
            >
              {t('search.none', { q: q.trim() })}
            </Typography>
          ) : (
            <List
              id="site-search-results"
              role="listbox"
              dense
              disablePadding
              data-testid="site-search-results"
            >
              {groups.map((group) => {
                const inGroup = hits.filter((h) => h.group === group);
                if (inGroup.length === 0) return null;
                return (
                  <Box key={group} component="li" sx={{ listStyle: 'none' }}>
                    <ListSubheader
                      disableSticky
                      sx={{
                        lineHeight: 2.2,
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: 0.6,
                      }}
                    >
                      {t(`search.groups.${group}`)}
                    </ListSubheader>
                    <Box component="ul" sx={{ p: 0, m: 0 }}>
                      {inGroup.map((hit) => {
                        const index = hits.indexOf(hit);
                        return (
                          <ListItemButton
                            key={hit.key}
                            role="option"
                            aria-selected={index === active}
                            selected={index === active}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => go(hit)}
                            data-testid={`site-search-hit-${hit.key}`}
                            sx={{ gap: 1.25 }}
                          >
                            {hit.avatar && (
                              <PlayerAvatar
                                id={hit.avatar.id}
                                name={hit.avatar.name}
                                avatarUrl={hit.avatar.url ?? undefined}
                                size={24}
                              />
                            )}
                            <Typography
                              variant="body2"
                              sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                            >
                              {hit.label}
                            </Typography>
                            {hit.detail && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
                                sx={{ maxWidth: '45%' }}
                              >
                                {hit.detail}
                              </Typography>
                            )}
                          </ListItemButton>
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </List>
          )}
        </Box>
      </Dialog>
    </>
  );
}
