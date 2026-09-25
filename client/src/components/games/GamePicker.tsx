/* global AbortController */
import React, { useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import { useTranslation } from 'react-i18next';
import { GameMark } from '../common/GameMark';
import { ExternalLink } from '../common/ExternalLink';
import {
  MAX_PLAYER_GAMES,
  SEARCH_MIN_LENGTH,
  fetchSuggestions,
  searchGames,
  type GameSummary,
} from './gamesApi';

const DEBOUNCE_MS = 250;

interface GamePickerProps {
  value: GameSummary[];
  onChange: (games: GameSummary[]) => void;
  /** Focus the search box on mount (the dialogs). */
  autoFocus?: boolean;
}

/**
 * Pick the games you play: type-to-search (IGDB-backed, debounced), up to
 * three suggestions under the input, picked games as removable chips.
 *
 * The search box is an MUI Autocomplete, so the combobox semantics come with
 * it: arrow keys move through results, Enter picks, Escape closes the list.
 * Picking clears the input so the next game can be typed straight away.
 */
export function GamePicker({ value, onChange, autoFocus }: GamePickerProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  // The last answer from the server, keyed by the query it answers.
  const [resolved, setResolved] = useState<{ q: string; games: GameSummary[]; failed: boolean }>({
    q: '',
    games: [],
    failed: false,
  });
  const [fromIgdb, setFromIgdb] = useState(false);
  const [fromWikidata, setFromWikidata] = useState(false);
  const [suggestions, setSuggestions] = useState<GameSummary[]>([]);

  const pickedIds = useMemo(() => new Set(value.map((g) => g.id)), [value]);
  const atLimit = value.length >= MAX_PLAYER_GAMES;
  const query = input.trim();
  const tooShort = query.length < SEARCH_MIN_LENGTH;
  const loading = !tooShort && resolved.q !== query;
  const failed = !tooShort && resolved.q === query && resolved.failed;

  useEffect(() => {
    let cancelled = false;
    void fetchSuggestions().then((games) => {
      if (!cancelled) setSuggestions(games);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (query.length < SEARCH_MIN_LENGTH) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchGames(query, controller.signal)
        .then((res) => {
          setResolved({ q: query, games: res.games, failed: false });
          // Sticky for this picker: the credit stays once external data is on screen.
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

  // While the next answer is on its way, keep showing the previous one.
  const options = tooShort ? [] : resolved.games.filter((g) => !pickedIds.has(g.id));
  const visibleSuggestions = suggestions.filter((g) => !pickedIds.has(g.id)).slice(0, 3);

  const add = (game: GameSummary) => {
    if (pickedIds.has(game.id) || atLimit) return;
    onChange([...value, game]);
    setInput('');
  };

  const remove = (game: GameSummary) => onChange(value.filter((g) => g.id !== game.id));

  const noOptionsText =
    tooShort
      ? t('games.picker.minChars')
      : failed
        ? t('games.picker.searchFailed')
        : t('games.picker.noResults');

  // Picked games carry the credit of whichever external source supplied them,
  // even once search has moved on (e.g. after a reload). IGDB takes priority
  // over Wikidata if a session somehow saw both.
  const showIgdbCredit = fromIgdb || value.some((g) => g.source === 'igdb');
  const showWikidataCredit = !showIgdbCredit && (fromWikidata || value.some((g) => g.source === 'wikidata'));
  const showCredit = showIgdbCredit || showWikidataCredit;

  return (
    <Stack spacing={2} data-testid="game-picker">
      <Box>
        <Autocomplete<GameSummary, false, false, false>
          open={open && input.trim().length > 0}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          value={null}
          inputValue={input}
          onInputChange={(_e, next, reason) => {
            // MUI resets the input to the (null) value after a pick; that
            // reset is ours to do in `add`.
            if (reason === 'reset') return;
            setInput(next);
          }}
          onChange={(_e, game) => {
            if (game) add(game);
          }}
          options={options}
          // The server already filtered; do not filter again by label.
          filterOptions={(x) => x}
          getOptionLabel={(g) => g.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          loading={loading}
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
                <GameMark
                  name={game.name}
                  slug={game.slug}
                  iconUrl={game.appIconUrl}
                  coverUrl={game.coverUrl}
                  size={32}
                />
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
              autoFocus={autoFocus}
              helperText={atLimit ? t('games.picker.limit', { max: MAX_PLAYER_GAMES }) : undefined}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={18} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
              inputProps={{ ...params.inputProps, 'data-testid': 'game-search-input' }}
            />
          )}
        />

        {visibleSuggestions.length > 0 && !atLimit && (
          <Box
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}
            data-testid="game-suggestions"
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
                avatar={
                  <GameMark
                    name={game.name}
                    slug={game.slug}
                    iconUrl={game.appIconUrl}
                    coverUrl={game.coverUrl}
                    size={20}
                  />
                }
                onClick={() => add(game)}
                data-testid={`game-suggestion-${game.slug}`}
              />
            ))}
          </Box>
        )}
      </Box>

      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('games.picker.yourGames')}
        </Typography>
        {value.length === 0 ? (
          <Typography variant="body2" color="text.disabled">
            {t('games.picker.none')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }} data-testid="game-chips">
            {value.map((game) => (
              <Chip
                key={game.id}
                label={game.name}
                avatar={
                  <GameMark
                    name={game.name}
                    slug={game.slug}
                    iconUrl={game.appIconUrl}
                    coverUrl={game.coverUrl}
                    size={20}
                  />
                }
                onDelete={() => remove(game)}
                title={t('games.picker.remove', { name: game.name })}
                data-testid={`game-chip-${game.slug}`}
              />
            ))}
          </Box>
        )}
      </Box>

      {showCredit && (
        <Typography variant="caption" color="text.secondary" data-testid="igdb-credit">
          {showWikidataCredit ? (
            <ExternalLink
              href="https://www.wikidata.org"
              color="inherit"
              data-testid="wikidata-credit-link"
            >
              {t('games.picker.creditWikidata')}
            </ExternalLink>
          ) : (
            t('games.picker.credit')
          )}
        </Typography>
      )}
    </Stack>
  );
}
