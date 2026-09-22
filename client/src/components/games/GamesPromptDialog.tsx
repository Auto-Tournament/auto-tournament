import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { apiErrorMessage } from '../../utils/api';
import { GamePicker } from './GamePicker';
import { dismissGamesPrompt, fetchMyGames, saveMyGames, type GameSummary } from './gamesApi';

/**
 * "What do you play?": shown once to a signed-in player who has no games yet.
 *
 * The API decides (`showPrompt` on GET /api/me/games), so skipping is stored
 * on the account and follows the player to other browsers. Never shown while
 * an admin impersonates: the endpoints answer for the real session.
 */
export function GamesPromptDialog() {
  const { t } = useTranslation();
  const { playerSteamId, impersonation, isLoading } = useAuth();
  const { showSuccess, showError } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null);

  useEffect(() => {
    if (isLoading || !playerSteamId || impersonation) {
      setOpen(false);
      return;
    }
    let cancelled = false;
    void fetchMyGames()
      .then((mine) => {
        if (!cancelled && mine?.showPrompt) {
          setGames(mine.games);
          setOpen(true);
        }
      })
      .catch(() => {
        // No prompt if we cannot tell.
      });
    return () => {
      cancelled = true;
    };
  }, [playerSteamId, impersonation, isLoading]);

  const skip = async () => {
    setBusy('skip');
    try {
      await dismissGamesPrompt();
    } catch {
      // Closing matters more than remembering; it will ask again next time.
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await saveMyGames(games);
      showSuccess(t('games.profile.saved'));
      setOpen(false);
    } catch (err) {
      showError(apiErrorMessage(err, t('games.profile.saveFailed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        // A stray backdrop click should not count as "skip".
        if (reason !== 'backdropClick') void skip();
      }}
      fullWidth
      maxWidth="sm"
      aria-labelledby="games-prompt-title"
      data-testid="games-prompt-dialog"
    >
      <DialogTitle id="games-prompt-title">{t('games.prompt.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          {t('games.prompt.description')}
        </Typography>
        <GamePicker value={games} onChange={setGames} autoFocus />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between' }}>
        <Button onClick={() => void skip()} disabled={busy !== null} data-testid="games-prompt-skip">
          {t('games.prompt.skip')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={busy !== null || games.length === 0}
          startIcon={busy === 'save' ? <CircularProgress size={16} color="inherit" /> : undefined}
          data-testid="games-prompt-save"
        >
          {t('games.prompt.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
