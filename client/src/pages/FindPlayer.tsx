import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Container,
  CircularProgress,
  InputAdornment,
  Autocomplete,
} from '@mui/material';
import Stack from '@mui/material/Stack';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import PlayerSearchResultsModal from '../components/modals/PlayerSearchResultsModal';
import { useSnackbar } from '../contexts/SnackbarContext';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import { TopNavBar } from '../components/layout/TopNavBar';

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
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerOption | null>(null);
  const { showError } = useSnackbar();

  useEffect(() => {
    document.title = t('findPlayer.title');
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      const value = (e.target as HTMLInputElement).value;
      handleSearch(value);
    }
  };

  return (
    <Box minHeight="100vh" bgcolor="background.default" data-testid="find-player-page">
      <TopNavBar />
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Card data-testid="find-player-form">
          <CardContent>
            <Box textAlign="center" mb={4}>
              <PersonIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
              <Typography variant="h4" fontWeight={700} gutterBottom>
                {t('findPlayer.title')}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {t('findPlayer.subtitle')}
              </Typography>
            </Box>

            <Box mb={3}>
              <Autocomplete
                options={players}
                loading={playersLoading}
                getOptionLabel={(option) => option.name}
                onChange={(_, newValue) => {
                  if (newValue && typeof newValue !== 'string') {
                    setSelectedPlayer(newValue);
                    navigate(`/player/${newValue.id}`);
                  }
                }}
                inputValue={inputValue}
                onInputChange={(_, newInputValue) => {
                  // If the user is typing, drop any prior selection so styling
                  // doesn't "stick" incorrectly.
                  if (selectedPlayer && newInputValue !== selectedPlayer.name) {
                    setSelectedPlayer(null);
                  }
                  setInputValue(newInputValue);
                  setQuery(newInputValue);
                  if (inputError) {
                    setInputError(null);
                  }
                }}
                slotProps={{
                  // When there are no options to select, don't let the "No players found" popper
                  // intercept clicks on the Find Player button below.
                  paper: {
                    sx: players.length === 0 ? { pointerEvents: 'none' } : undefined,
                  },
                }}
                renderOption={(props, option) => (
                  <Box
                    component="li"
                    {...props}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <PlayerAvatar
                      id={option.id}
                      name={option.name}
                      avatarUrl={option.avatar}
                      size={24}
                      isAdmin={option.isAdmin}
                    />
                    <Box>
                      <PlayerName name={option.name} isAdmin={option.isAdmin} variant="body2" />
                      <Typography variant="caption" color="text.secondary">
                        {option.id}
                      </Typography>
                    </Box>
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    fullWidth
                    label={t('findPlayer.searchLabel')}
                    placeholder={t('findPlayer.searchPlaceholder')}
                    onKeyPress={handleKeyPress}
                    disabled={loading}
                    error={!!inputError}
                    helperText={inputError || undefined}
                    sx={{
                      ...(selectedPlayer?.isAdmin
                        ? {
                            '& .MuiInputBase-input': {
                              color: 'error.main',
                              fontWeight: 700,
                            },
                          }
                        : undefined),
                    }}
                    slotProps={{
                      htmlInput: {
                        ...params.inputProps,
                        'data-testid': 'find-player-input',
                      },
                    }}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <InputAdornment position="start">
                          {playersLoading ? <CircularProgress size={20} /> : <SearchIcon />}
                        </InputAdornment>
                      ),
                    }}
                  />
                )}
                noOptionsText={
                  playersLoading
                    ? t('findPlayer.noOptionsLoading')
                    : t('findPlayer.noOptionsEmpty')
                }
              />
            </Box>

            <Stack spacing={2}>
              <Button
                data-testid="find-player-button"
                fullWidth
                variant="contained"
                size="large"
                onClick={() => handleSearch(inputValue)}
                disabled={loading || !inputValue.trim()}
                startIcon={loading ? <CircularProgress size={20} /> : <SearchIcon />}
              >
                {loading ? t('findPlayer.searching') : t('findPlayer.searchButton')}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Container>

      <PlayerSearchResultsModal
        open={showResultsModal}
        players={searchResults}
        onClose={() => setShowResultsModal(false)}
      />
    </Box>
  );
}
