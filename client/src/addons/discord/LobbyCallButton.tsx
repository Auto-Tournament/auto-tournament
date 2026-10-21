import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

/**
 * "Call to the Lobby" on a running tournament, for an admin (the Discord
 * add-on): moves its players in voice into the tournament's Lobby, DMs the
 * rest and posts in its #chat. Nothing while the tournament has no Lobby.
 */
export function LobbyCallButton({ tournamentId }: { tournamentId: number }) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [lobby, setLobby] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [includeLive, setIncludeLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = `/api/addons/discord/tournaments/${tournamentId}/lobby`;
  useEffect(() => {
    let live = true;
    api
      .get<{ lobby: boolean }>(base)
      .then((r) => live && setLobby(r.lobby))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [base]);
  if (!lobby) return null;

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ moved: number; messaged: number }>(base, { message, includeLive });
      showSuccess(t('discordBot.lobbyCall.done', { moved: r.moved, messaged: r.messaged }));
      setOpen(false);
      setMessage('');
    } catch (e) {
      showError(apiErrorMessage(e, t('discordBot.lobbyCall.failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={() => setOpen(true)}
        data-testid="discord-lobby-call"
        sx={{ alignSelf: 'flex-start', mb: 2 }}
      >
        {t('discordBot.lobbyCall.button')}
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('discordBot.lobbyCall.title')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('discordBot.lobbyCall.message')}
            placeholder={t('discordBot.lobbyCall.placeholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 500))}
            multiline
            minRows={2}
            fullWidth
            margin="dense"
          />
          <FormControlLabel
            control={
              <Checkbox checked={includeLive} onChange={(e) => setIncludeLive(e.target.checked)} />
            }
            label={t('discordBot.lobbyCall.includeLive')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {t('discordBot.lobbyCall.cancel')}
          </Button>
          <Button variant="contained" onClick={() => void send()} disabled={busy}>
            {t('discordBot.lobbyCall.send')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
