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
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import { api } from '../utils/api';
import PlayerSearchResultsModal from '../components/modals/PlayerSearchResultsModal';
import { useSnackbar } from '../contexts/SnackbarContext';

interface PlayerOption {
  id: string;
  name: string;
  avatar?: string;
  currentElo?: number;
}

export default function FindPlayer() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; avatar?: string; currentElo?: number }>>([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const { showError } = useSnackbar();

  useEffect(() => {
    document.title = 'Find Player';
  }, []);

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
      showError('Please enter a Steam ID or profile URL');
      return;
    }

    setLoading(true);

    try {
      const response = await api.get<{
        success: boolean;
        player?: { id: string; name: string };
        players?: Array<{ id: string; name: string }>;
        error?: string;
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
          showError('Player not found');
        }
      } else {
        showError(response.error || 'Player not found');
      }
    } catch (err) {
      showError('Failed to search for player');
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
    <Box minHeight="100vh" bgcolor="background.default" py={6} data-testid="find-player-page">
      <Container maxWidth="sm">
        <Card data-testid="find-player-form">
          <CardContent>
            <Box textAlign="center" mb={4}>
              <PersonIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
              <Typography variant="h4" fontWeight={700} gutterBottom>
                Find Player
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Enter a Steam ID or Steam profile URL to view player statistics
              </Typography>
            </Box>


            <Box mb={3}>
              <Autocomplete
                options={players}
                loading={playersLoading}
                getOptionLabel={(option) => option.name}
                onChange={(_, newValue) => {
                  if (newValue && typeof newValue !== 'string') {
                    navigate(`/player/${newValue.id}`);
                  }
                }}
                inputValue={inputValue}
                onInputChange={(_, newInputValue) => {
                  setInputValue(newInputValue);
                  setQuery(newInputValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    fullWidth
                    label="Search by name, Steam ID or profile URL"
                    placeholder="Start typing a name or paste a Steam URL…"
                    onKeyPress={handleKeyPress}
                    disabled={loading}
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
                  playersLoading ? 'Loading players…' : 'No players found. Try typing a Steam ID or URL.'
                }
              />
            </Box>

            <Button
              data-testid="find-player-button"
              fullWidth
              variant="contained"
              size="large"
              onClick={() => handleSearch(inputValue)}
              disabled={loading || !inputValue.trim()}
              startIcon={loading ? <CircularProgress size={20} /> : <SearchIcon />}
            >
              {loading ? 'Searching...' : 'Find Player'}
            </Button>
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

