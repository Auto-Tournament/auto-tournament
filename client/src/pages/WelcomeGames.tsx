import { pageTitle } from '../utils/pageTitle';
/* global AbortController */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { MagnifyingGlassIcon, PlusIcon, TrophyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { GameCatalog } from '../components/catalog/GameCatalog';
import { useAuth } from '../contexts/AuthContext';
import { GameArt, GameCard } from '../components/games/GameCard';
import { GameMark } from '../components/common/GameMark';
import { safeNextPath } from '../components/games/nextPath';
import { ExternalLink } from '../components/common/ExternalLink';
import {
  MAX_PLAYER_GAMES,
  SEARCH_MIN_LENGTH,
  dismissGamesPrompt,
  fetchMyGames,
  fetchPopularGames,
  fetchSuggestions,
  saveMyGames,
  searchGames,
  type GameSummary,
} from '../components/games/gamesApi';
import { useSnackbar } from '../contexts/SnackbarContext';
import { apiErrorMessage } from '../utils/api';
import { fontDisplay, mono, tokens } from '../theme/tokens';

const { color, radius } = tokens;
const DEBOUNCE_MS = 250;
const SKELETON_CARDS = 10;

/**
 * "What do you play?" onboarding page: a full page (not the old modal) with
 * a search box and a grid of big cards for the built-in/popular games.
 *
 * Two modes, same page:
 * - first visit (no `edit` param): heading "What do you play?", primary
 *   button "Continue". Reached via `GamesOnboardingRedirect`.
 * - `?edit=1`: heading "Your games", primary button "Save" (no "Not now" —
 *   there is nothing to skip once games are already answered). Existing
 *   "Edit games" entry points may link here (see `App.tsx`); today the
 *   profile pages keep their own small inline picker instead (simpler, and
 *   this repo's PlayerProfile/OwnGamesCard is out of scope for this change).
 *
 * `?next=` (sanitised by `safeNextPath`) is where Continue/Not now send the
 * player afterwards — the page they were heading to when they got redirected
 * here, or "/".
 *
 * The art is the games catalogue's (Wikidata), never the module tiles:
 * the player is recognising their own game here. See `GameCard` for how each
 * kind of picture is drawn so it is neither cropped, stretched nor lost
 * against the dark card.
 */
export default function WelcomeGames() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useSnackbar();
  const [searchParams] = useSearchParams();

  // An admin also picks what this instance runs: a fresh install has no
  // games until one is installed from the catalog (DESIGN-modules §10).
  const { isAuthenticated } = useAuth();
  const isEdit = searchParams.get('edit') === '1';
  const next = safeNextPath(searchParams.get('next'));

  const [selected, setSelected] = useState<GameSummary[]>([]);
  const [popular, setPopular] = useState<GameSummary[]>([]);
  const [suggestions, setSuggestions] = useState<GameSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null);

  // Search combobox — same shape as GamePicker (debounced, server-filtered).
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<{ q: string; games: GameSummary[]; failed: boolean }>({
    q: '',
    games: [],
    failed: false,
  });
  const [fromWikidata, setFromWikidata] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchMyGames(), fetchPopularGames()]).then(([mine, games]) => {
      if (cancelled) return;
      if (mine) setSelected(mine.games);
      setPopular(games);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSuggestions().then((games) => {
      if (!cancelled) setSuggestions(games);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // After the admin installs or removes a game, the grid shows the new set.
  const refreshPopular = () => {
    void fetchPopularGames().then(setPopular);
  };

  const pickedIds = useMemo(() => new Set(selected.map((g) => g.id)), [selected]);
  const atLimit = selected.length >= MAX_PLAYER_GAMES;

  const query = input.trim();
  const tooShort = query.length < SEARCH_MIN_LENGTH;
  const searchLoading = !tooShort && resolved.q !== query;
  const searchFailed = !tooShort && resolved.q === query && resolved.failed;

  useEffect(() => {
    if (query.length < SEARCH_MIN_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchGames(query, controller.signal)
        .then((res) => {
          setResolved({ q: query, games: res.games, failed: false });
          if (res.fromWikidata) setFromWikidata(true);
        })
        .catch((err: unknown) => {
          if ((err as Error).name === 'AbortError') return;
          setResolved({ q: query, games: [], failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const searchOptions = tooShort ? [] : resolved.games.filter((g) => !pickedIds.has(g.id));
  const visibleSuggestions = suggestions.filter((g) => !pickedIds.has(g.id)).slice(0, 3);

  // The grid is the full built-in catalogue, always on screen (so an already
  // selected game shows selected instead of disappearing) plus anything a
  // search turned up that is not already a built-in card.
  const gridGames = useMemo(() => {
    const seen = new Set(popular.map((g) => g.id));
    const extra = selected.filter((g) => !seen.has(g.id));
    return [...popular, ...extra];
  }, [popular, selected]);

  const toggleSelect = (game: GameSummary) => {
    setSelected((prev) =>
      prev.some((g) => g.id === game.id) ? prev.filter((g) => g.id !== game.id) : atLimit ? prev : [...prev, game]
    );
  };

  const addFromSearch = (game: GameSummary) => {
    if (pickedIds.has(game.id) || atLimit) return;
    setSelected((prev) => [...prev, game]);
    setInput('');
  };

  const removeSelected = (game: GameSummary) => setSelected((prev) => prev.filter((g) => g.id !== game.id));

  // Keep the newest pick in view: the selected strip is one scrolling row, so
  // a game added from the search would otherwise land past its right edge.
  const chipStrip = useRef<HTMLDivElement>(null);
  const selectedCount = selected.length;
  const prevCount = useRef(selectedCount);
  useEffect(() => {
    const strip = chipStrip.current;
    if (strip && selectedCount > prevCount.current) {
      strip.scrollTo({ left: strip.scrollWidth, behavior: 'smooth' });
    }
    prevCount.current = selectedCount;
  }, [selectedCount]);

  const supportedLabel = t('games.welcome.supportedLegend');
  const continueLabel = isEdit ? t('games.profile.save') : t('games.welcome.continue');
  const heading = isEdit ? t('games.profile.title') : t('games.prompt.title');

  useEffect(() => {
    document.title = pageTitle(heading);
  }, [heading]);
  const description = isEdit ? t('games.profile.description') : t('games.prompt.description');

  const save = async () => {
    setBusy('save');
    try {
      await saveMyGames(selected);
      showSuccess(t('games.profile.saved'));
      navigate(next, { replace: true });
    } catch (err) {
      showError(apiErrorMessage(err, t('games.profile.saveFailed')));
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    setBusy('skip');
    try {
      await dismissGamesPrompt();
    } catch {
      // Moving on matters more than remembering; it will ask again next time.
    } finally {
      setBusy(null);
      navigate(next, { replace: true });
    }
  };

  // A game found back when IGDB search still existed (`source === 'igdb'`)
  // is credited to Wikidata too — that is the only external source left.
  const showCredit = fromWikidata || gridGames.some((g) => g.source === 'wikidata' || g.source === 'igdb');

  const noOptionsText = tooShort
    ? t('games.picker.minChars')
    : searchFailed
      ? t('games.picker.searchFailed')
      : t('games.picker.noResults');

  return (
    // Bottom padding clears the fixed bar: two rows under `md`, one above.
    <Box minHeight="100vh" bgcolor="transparent" sx={{ pb: { xs: 18, md: 12 } }}>
      <TopNavBar />
      <Container maxWidth="lg" sx={{ pt: { xs: 3, md: 6 }, pb: 4 }} data-testid="welcome-games-page">
        <Box component="header" sx={{ maxWidth: 640 }}>
          <Typography
            component="h1"
            variant="h4"
            sx={{
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: { xs: '1.75rem', sm: '2.25rem' },
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            {heading}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: '58ch' }}>
            {description}
          </Typography>

          <Box sx={{ mt: { xs: 3, md: 4 } }}>
            <Autocomplete<GameSummary, false, false, false>
              open={open && input.trim().length > 0}
              onOpen={() => setOpen(true)}
              onClose={() => setOpen(false)}
              value={null}
              inputValue={input}
              onInputChange={(_e, next2, reason) => {
                if (reason === 'reset') return;
                setInput(next2);
              }}
              onChange={(_e, game) => {
                if (game) addFromSearch(game);
              }}
              options={searchOptions}
              filterOptions={(x) => x}
              getOptionLabel={(g) => g.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              loading={searchLoading}
              loadingText={t('games.picker.loading')}
              noOptionsText={noOptionsText}
              disabled={atLimit}
              autoHighlight
              clearOnBlur={false}
              handleHomeEndKeys
              forcePopupIcon={false}
              renderOption={(props, game) => {
                const { key, ...rest } = props as typeof props & { key: React.Key };
                return (
                  <Box
                    component="li"
                    key={key}
                    {...rest}
                    data-testid={`game-option-${game.slug}`}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
                  >
                    <Box
                      sx={{
                        position: 'relative',
                        width: 30,
                        height: 40,
                        flexShrink: 0,
                        borderRadius: 0.75,
                        overflow: 'hidden',
                      }}
                    >
                      <GameArt game={game} compact />
                    </Box>
                    <Typography variant="body2" fontWeight={500} noWrap sx={{ minWidth: 0, flex: 1 }}>
                      {game.name}
                    </Typography>
                    {game.releaseYear && (
                      <Typography variant="caption" color="text.secondary" sx={mono}>
                        {game.releaseYear}
                      </Typography>
                    )}
                    {game.supported && (
                      <Tooltip title={supportedLabel}>
                        <Box component={TrophyIcon} size={18} role="img" aria-label={supportedLabel} sx={{ color: 'primary.main', flexShrink: 0 }} />
                      </Tooltip>
                    )}
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={t('games.picker.searchLabel')}
                  autoFocus
                  helperText={atLimit ? t('games.picker.limit', { max: MAX_PLAYER_GAMES }) : undefined}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: `${radius.pill}px`,
                      bgcolor: 'background.surface1',
                      pl: 2,
                      minHeight: 52,
                    },
                  }}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box component={MagnifyingGlassIcon} sx={{ color: 'text.secondary' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <>
                        {searchLoading ? <CircularProgress color="inherit" size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  inputProps={{
                    ...params.inputProps,
                    'aria-label': t('games.picker.searchLabel'),
                    'data-testid': 'welcome-games-search-input',
                  }}
                />
              )}
            />

            {visibleSuggestions.length > 0 && !atLimit && (
              <Box
                sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5, pl: 0.5 }}
                data-testid="welcome-games-suggestions"
              >
                <Typography variant="body2" color="text.secondary">
                  {t('games.picker.suggestionsLabel')}
                </Typography>
                {visibleSuggestions.map((game) => (
                  <Chip
                    key={game.id}
                    variant="outlined"
                    label={game.name}
                    icon={<PlusIcon />}
                    onClick={() => addFromSearch(game)}
                    data-testid={`welcome-games-suggestion-${game.slug}`}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {isAuthenticated && (
          <Box
            component="section"
            sx={{
              mt: { xs: 5, md: 7 },
              p: { xs: 2, md: 3 },
              borderRadius: `${radius.md}px`,
              border: `1px solid ${color.rule}`,
              bgcolor: 'background.surface1',
            }}
            data-testid="welcome-games-instance"
          >
            <Typography component="h2" variant="h6" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
              {t('catalog.welcome.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '64ch' }}>
              {t('catalog.welcome.hint')}
            </Typography>
            <GameCatalog showBuiltins onChanged={refreshPopular} />
          </Box>
        )}

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            columnGap: 2,
            rowGap: 0.5,
            mt: { xs: 5, md: 7 },
            mb: 2,
          }}
        >
          <Typography component="h2" variant="h6" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
            {t('games.welcome.gridTitle')}
          </Typography>
          {/* Said once here, and a trophy on each card, instead of the same
              sentence printed under every game. */}
          {gridGames.some((g) => g.supported) && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
              data-testid="welcome-games-legend"
            >
              <Box component={TrophyIcon} size={18} aria-hidden sx={{ color: 'primary.main' }} />
              {supportedLabel}
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(auto-fill, minmax(176px, 1fr))',
              md: 'repeat(auto-fill, minmax(196px, 1fr))',
            },
            gap: { xs: 1.5, sm: 2 },
          }}
          aria-busy={!loaded}
          data-testid="welcome-games-grid"
        >
          {!loaded
            ? Array.from({ length: SKELETON_CARDS }, (_, i) => (
                <Box key={i} aria-hidden>
                  <Skeleton
                    variant="rounded"
                    sx={{ width: '100%', height: 'auto', aspectRatio: '3 / 4', borderRadius: `${radius.md}px` }}
                  />
                  <Skeleton variant="text" sx={{ mt: 1, width: '70%' }} />
                </Box>
              ))
            : gridGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  selected={pickedIds.has(game.id)}
                  locked={atLimit}
                  onToggle={toggleSelect}
                />
              ))}
        </Box>

        {showCredit && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }} data-testid="wikidata-credit">
            <ExternalLink
              href="https://www.wikidata.org"
              color="inherit"
              data-testid="wikidata-credit-link"
            >
              {t('games.picker.creditWikidata')}
            </ExternalLink>
          </Typography>
        )}
      </Container>

      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          bgcolor: color.navGlass,
          backdropFilter: 'blur(14px)',
          borderTop: `1px solid ${color.rule}`,
          zIndex: 10,
          pb: 'env(safe-area-inset-bottom)',
        }}
        data-testid="welcome-games-bottom-bar"
      >
        <Container
          maxWidth="lg"
          sx={{
            py: 1.5,
            display: 'flex',
            flexWrap: { xs: 'wrap', md: 'nowrap' },
            alignItems: 'center',
            columnGap: 2,
            rowGap: 1.25,
          }}
        >
          <Typography
            variant="body2"
            fontWeight={600}
            aria-live="polite"
            sx={{ ...mono, order: { xs: 2, md: 0 }, flexShrink: 0, whiteSpace: 'nowrap' }}
            data-testid="welcome-games-count"
          >
            {t('games.welcome.selectedCount', { count: selected.length, max: MAX_PLAYER_GAMES })}
          </Typography>

          {/* One scrolling row, not a wrapping pile: thirty picks must not
              push the bar up over the grid on a phone. */}
          <Box
            ref={chipStrip}
            role="group"
            aria-label={t('games.welcome.selectedGames')}
            sx={{
              order: { xs: 1, md: 0 },
              flex: { xs: '1 1 100%', md: '1 1 auto' },
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              overflowX: 'auto',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
            data-testid="welcome-games-selected-chips"
          >
            {selected.length === 0 ? (
              <Typography variant="body2" color="text.secondary" noWrap>
                {t('games.welcome.pickOne')}
              </Typography>
            ) : (
              selected.map((game) => (
                <Chip
                  key={game.id}
                  label={game.name}
                  avatar={
                    <GameMark
                      name={game.name}
                      slug={game.slug}
                      iconUrl={game.appIconUrl}
                      neutral
                      size={20}
                    />
                  }
                  onDelete={() => removeSelected(game)}
                  title={t('games.picker.remove', { name: game.name })}
                  data-testid={`welcome-games-chip-${game.slug}`}
                  sx={{ flexShrink: 0 }}
                />
              ))
            )}
          </Box>

          <Box sx={{ order: 3, ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {!isEdit && (
              <Button onClick={() => void skip()} disabled={busy !== null} data-testid="welcome-games-not-now">
                {t('games.welcome.notNow')}
              </Button>
            )}
            <Button
              variant="contained"
              onClick={() => void save()}
              disabled={busy !== null || selected.length === 0}
              startIcon={busy === 'save' ? <CircularProgress size={16} color="inherit" /> : undefined}
              data-testid="welcome-games-continue"
              sx={{ borderRadius: `${radius.pill}px`, px: 3.5 }}
            >
              {continueLabel}
            </Button>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
