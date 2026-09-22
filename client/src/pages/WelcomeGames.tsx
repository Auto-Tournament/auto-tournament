/* global AbortController */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { GameCard } from '../components/games/GameCard';
import { GameThumb } from '../components/games/GameThumb';
import { safeNextPath } from '../components/games/nextPath';
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
import { fontDisplay, tokens } from '../theme/tokens';

const { color, radius } = tokens;
const DEBOUNCE_MS = 250;

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
 */
export default function WelcomeGames() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useSnackbar();
  const [searchParams] = useSearchParams();

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
  const [fromIgdb, setFromIgdb] = useState(false);
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
          if (res.fromIgdb) setFromIgdb(true);
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

  const continueLabel = isEdit ? t('games.profile.save') : t('games.welcome.continue');
  const heading = isEdit ? t('games.profile.title') : t('games.prompt.title');
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

  const showIgdbCredit = fromIgdb || gridGames.some((g) => g.source === 'igdb');
  const showWikidataCredit = !showIgdbCredit && (fromWikidata || gridGames.some((g) => g.source === 'wikidata'));
  const showCredit = showIgdbCredit || showWikidataCredit;

  const noOptionsText = tooShort
    ? t('games.picker.minChars')
    : searchFailed
      ? t('games.picker.searchFailed')
      : t('games.picker.noResults');

  return (
    <Box minHeight="100vh" bgcolor="transparent" sx={{ pb: { xs: 12, sm: 14 } }}>
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }} data-testid="welcome-games-page">
        <Typography
          component="h1"
          variant="h4"
          sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: { xs: '1.5rem', sm: '2rem' } }}
        >
          {heading}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1, mb: 4, maxWidth: '62ch' }}>
          {description}
        </Typography>

        <Box sx={{ maxWidth: 560 }}>
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
                  <GameThumb name={game.name} coverUrl={game.imageUrl} size={36} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>
                      {game.name}
                    </Typography>
                    {game.supported && (
                      <Typography
                        variant="caption"
                        color="primary"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                      >
                        <EmojiEventsOutlinedIcon sx={{ fontSize: 14 }} aria-hidden />
                        {t('games.picker.supported')}
                      </Typography>
                    )}
                  </Box>
                  {game.releaseYear && (
                    <Typography variant="caption" color="text.secondary">
                      {game.releaseYear}
                    </Typography>
                  )}
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('games.picker.searchLabel')}
                placeholder={t('games.picker.placeholder')}
                autoFocus
                size="medium"
                helperText={atLimit ? t('games.picker.limit', { max: MAX_PLAYER_GAMES }) : undefined}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searchLoading ? <CircularProgress color="inherit" size={18} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                inputProps={{ ...params.inputProps, 'data-testid': 'welcome-games-search-input' }}
              />
            )}
          />

          {visibleSuggestions.length > 0 && !atLimit && (
            <Box
              sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}
              data-testid="welcome-games-suggestions"
            >
              <Typography variant="body2" color="text.secondary">
                {t('games.picker.suggestionsLabel')}
              </Typography>
              {visibleSuggestions.map((game) => (
                <Chip
                  key={game.id}
                  variant="outlined"
                  size="small"
                  label={game.name}
                  avatar={<GameThumb name={game.name} coverUrl={game.imageUrl} size={20} />}
                  onClick={() => addFromSearch(game)}
                  data-testid={`welcome-games-suggestion-${game.slug}`}
                />
              ))}
            </Box>
          )}
        </Box>

        <Typography variant="h6" sx={{ fontFamily: fontDisplay, fontWeight: 600, mt: 5, mb: 2 }}>
          {t('games.welcome.gridTitle')}
        </Typography>

        {!loaded ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
                lg: 'repeat(5, minmax(0, 1fr))',
              },
              gap: { xs: 1.5, sm: 2 },
            }}
            data-testid="welcome-games-grid"
          >
            {gridGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                selected={pickedIds.has(game.id)}
                onToggle={toggleSelect}
              />
            ))}
          </Box>
        )}

        {showCredit && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }} data-testid="igdb-credit">
            {showWikidataCredit ? (
              <Link
                href="https://www.wikidata.org"
                target="_blank"
                rel="noopener noreferrer"
                color="inherit"
                data-testid="wikidata-credit-link"
              >
                {t('games.picker.creditWikidata')}
              </Link>
            ) : (
              t('games.picker.credit')
            )}
          </Typography>
        )}
      </Container>

      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          bgcolor: color.paper2,
          borderTop: `1px solid ${color.rule}`,
          zIndex: 10,
        }}
        data-testid="welcome-games-bottom-bar"
      >
        <Container maxWidth="lg" sx={{ py: 2 }}>
          {selected.length > 0 && (
            <Box
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}
              data-testid="welcome-games-selected-chips"
              aria-label={t('games.welcome.selectedGames')}
            >
              {selected.map((game) => (
                <Chip
                  key={game.id}
                  label={game.name}
                  avatar={<GameThumb name={game.name} coverUrl={game.imageUrl} size={20} />}
                  onDelete={() => removeSelected(game)}
                  title={t('games.picker.remove', { name: game.name })}
                  data-testid={`welcome-games-chip-${game.slug}`}
                />
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
            {!isEdit ? (
              <Button onClick={() => void skip()} disabled={busy !== null} data-testid="welcome-games-not-now">
                {t('games.welcome.notNow')}
              </Button>
            ) : (
              <Box />
            )}
            <Button
              variant="contained"
              onClick={() => void save()}
              disabled={busy !== null || selected.length === 0}
              startIcon={busy === 'save' ? <CircularProgress size={16} color="inherit" /> : undefined}
              data-testid="welcome-games-continue"
              sx={{ borderRadius: `${radius.pill}px`, px: 3 }}
            >
              {continueLabel}
            </Button>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
