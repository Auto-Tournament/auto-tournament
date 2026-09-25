import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { apiErrorMessage } from '../../utils/api';
import { GamePicker } from './GamePicker';
import { GameMark } from '../common/GameMark';
import { GAMES_UPDATED_EVENT, fetchMyGames, saveMyGames, type GameSummary } from './gamesApi';

/**
 * "Your games" on the player's own profile, with an Edit button that opens the
 * same picker as the first-visit dialog. Only render it on the viewer's own
 * profile and not while impersonating (like OwnDiscordIdCard): the endpoint
 * answers for the session. Hides itself when the API does not answer.
 */
export function OwnGamesCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GameSummary[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await fetchMyGames();
      setGames(mine ? mine.games : null);
    } catch {
      setGames(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const onUpdated = () => void load();
    window.addEventListener(GAMES_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(GAMES_UPDATED_EVENT, onUpdated);
  }, [load]);

  if (games === null) return null;

  const openEditor = () => {
    setDraft(games);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveMyGames(draft);
      setGames(saved.games);
      setEditing(false);
      showSuccess(t('games.profile.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('games.profile.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="profile-games-section">
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" fontWeight={600}>
            {t('games.profile.title')}
          </Typography>
          <Button
            size="small"
            startIcon={<EditOutlinedIcon />}
            onClick={openEditor}
            data-testid="profile-games-edit"
          >
            {games.length === 0 ? t('games.profile.add') : t('games.profile.edit')}
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('games.profile.description')}
        </Typography>
        {games.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ mt: 2 }}>
            {t('games.profile.empty')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }} data-testid="profile-games">
            {games.map((game) => (
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
                data-testid={`profile-game-${game.slug}`}
              />
            ))}
          </Box>
        )}
      </CardContent>

      <Dialog
        open={editing}
        onClose={() => !saving && setEditing(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="own-games-dialog-title"
      >
        <DialogTitle id="own-games-dialog-title">{t('games.profile.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <GamePicker value={draft} onChange={setDraft} autoFocus />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEditing(false)} disabled={saving}>
            {t('games.profile.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            data-testid="profile-games-save"
          >
            {t('games.profile.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
