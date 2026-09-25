import { pageTitle } from '../utils/pageTitle';
import React, { useState, useEffect, useMemo } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Button,
  Container,
  CircularProgress,
  InputAdornment,
  Chip,
} from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { PageHead, Row, RowList } from '../components/common/ui';
import { tokens } from '../theme/tokens';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import PlayerSearchResultsModal from '../components/modals/PlayerSearchResultsModal';
import { useSnackbar } from '../contexts/SnackbarContext';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import { TopNavBar } from '../components/layout/TopNavBar';

/** How many directory rows show at once; typing narrows the rest. */
const DIRECTORY_ROWS = 50;

interface PlayerOption {
  id: string;
  name: string;
  avatar?: string;
  currentElo?: number;
  isAdmin?: boolean;
}

export default function FindPlayer() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; name: string; avatar?: string; currentElo?: number }>
  >([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const { showError } = useSnackbar();

  // The directory under the search: everyone whose name or Steam ID holds
  // what was typed, the first rows only, so a big site stays a short page.
  const matching = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    const list = q
      ? players.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q))
      : players;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [players, inputValue]);
  const shown = matching.slice(0, DIRECTORY_ROWS);

  useEffect(() => {
    document.title = pageTitle(t('findPlayer.title'));
  }, [t]);

  useEffect(() => {
    const loadPlayers = async () => {
      try {
        setPlayersLoading(true);
        const response = await api.get<{
          success: boolean;
          players: PlayerOption[];
        }>('/api/players/public-selection');

        if (response.success && Array.isArray(response.players)) {
          setPlayers(response.players);
        }
      } catch (err) {
        console.error('Failed to load player list for autocomplete', err);
      } finally {
        setPlayersLoading(false);
      }
    };

    loadPlayers();
  }, []);

  const handleSearch = async (rawQuery?: string) => {
    const effectiveQuery = (rawQuery ?? query).trim();

    if (!effectiveQuery) {
      setInputError(t('findPlayer.inputErrorEmpty'));
      return;
    }

    setLoading(true);
    setInputError(null);

    try {
      const response = await api.get<{
        success: boolean;
        player?: { id: string; name: string };
        players?: Array<{ id: string; name: string }>;
        error?: string;
        steamApiConfigured?: boolean;
      }>(`/api/players/find?query=${encodeURIComponent(effectiveQuery)}`);

      if (response.success) {
        if (response.player) {
          // Single player found - redirect to their page
          navigate(`/player/${response.player.id}`);
        } else if (response.players && response.players.length > 0) {
          // Check if single player or multiple players
          if (response.players.length === 1) {
            // Single player found - redirect to their page
            navigate(`/player/${response.players[0].id}`);
          } else {
            // Multiple players found - show selection modal
            setSearchResults(response.players);
            setShowResultsModal(true);
          }
        } else {
          setInputError(t('findPlayer.inputErrorNotFound'));
        }
      } else {
        setInputError(
          response.error ||
            (response.steamApiConfigured === false
              ? t('findPlayer.inputErrorSteamNotConfigured')
              : t('findPlayer.inputErrorNotFound'))
        );
      }
    } catch (err) {
      showError(t('findPlayer.searchError'));
      setInputError(t('findPlayer.searchError'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="find-player-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <PageHead title={t('findPlayer.title')} subtitle={t('findPlayer.subtitle')} />

        {/* One search: it narrows the directory as you type, and Enter (or
            Find) looks up anything the list cannot hold, like a Steam
            profile URL. */}
        <Box
          component="form"
          data-testid="find-player-form"
          role="search"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            if (!loading) void handleSearch(inputValue);
          }}
          sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 3 }}
        >
          <TextField
            fullWidth
            label={t('findPlayer.searchLabel')}
            placeholder={t('findPlayer.searchPlaceholder')}
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              setQuery(event.target.value);
              if (inputError) setInputError(null);
            }}
            disabled={loading}
            error={!!inputError}
            helperText={inputError || undefined}
            slotProps={{
              htmlInput: { 'data-testid': 'find-player-input' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    {playersLoading || loading ? <CircularProgress size={20} /> : <MagnifyingGlassIcon />}
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button
            data-testid="find-player-button"
            type="submit"
            variant="contained"
            disabled={loading || !inputValue.trim()}
            sx={{ flex: 'none', mt: 1 }}
          >
            {loading ? t('findPlayer.searching') : t('findPlayer.searchButton')}
          </Button>
        </Box>

        {!playersLoading && matching.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="find-player-directory-empty">
            {players.length === 0 ? t('findPlayer.noOptionsEmpty') : t('findPlayer.directoryNoMatch')}
          </Typography>
        ) : (
          <>
            <RowList data-testid="find-player-directory" aria-label={t('findPlayer.directoryLabel')}>
              {shown.map((player) => (
                <Row key={player.id} sx={{ p: 0 }}>
                  <Box
                    component={RouterLink}
                    to={`/player/${player.id}`}
                    data-testid={`find-player-row-${player.id}`}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                      alignItems: 'center',
                      gap: 2,
                      px: 3,
                      py: 1.5,
                      color: 'inherit',
                      textDecoration: 'none',
                      borderRadius: 'inherit',
                      '&:hover': { bgcolor: tokens.color.paper3 },
                    }}
                  >
                    <PlayerAvatar
                      id={player.id}
                      name={player.name}
                      avatarUrl={player.avatar}
                      size={32}
                      isAdmin={player.isAdmin}
                    />
                    <PlayerName name={player.name} isAdmin={player.isAdmin} variant="body1" noWrap sx={{ fontWeight: 600 }} />
                    {typeof player.currentElo === 'number' && (
                      <Chip size="small" label={t('playersPage.skillRatingLabel', { elo: player.currentElo })} />
                    )}
                  </Box>
                </Row>
              ))}
            </RowList>
            {matching.length > shown.length && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                {t('findPlayer.directoryMore', { count: matching.length - shown.length })}
              </Typography>
            )}
          </>
        )}
      </Container>

      <PlayerSearchResultsModal
        open={showResultsModal}
        players={searchResults}
        onClose={() => setShowResultsModal(false)}
      />
    </Box>
  );
}
