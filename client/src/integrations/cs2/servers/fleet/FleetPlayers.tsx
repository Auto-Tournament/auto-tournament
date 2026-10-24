/** Who is on a Ready Up server, from its latest snapshot, and kicking one of them. */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { api, apiErrorMessage, useModuleTranslation, useSnackbar } from '../../../../module-sdk';
import type { FleetHostServerRef, FleetPlayer } from '../../cs2.types';

const POLL_MS = 10_000;
const TEAM_ORDER: FleetPlayer['team'][] = ['ct', 't', 'spectator', 'none'];

export function FleetPlayers({ server }: { server: FleetHostServerRef }) {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [kicking, setKicking] = useState<FleetPlayer | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [listed, setListed] = useState<FleetPlayer[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ players: FleetPlayer[] }>(
        `/api/fleet/servers/${server.id}/players`
      );
      setListed(res.players);
    } catch {
      setListed([]);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const players = [...listed].sort(
    (a, b) =>
      TEAM_ORDER.indexOf(a.team) - TEAM_ORDER.indexOf(b.team) || a.name.localeCompare(b.name)
  );

  const kick = async () => {
    if (!kicking || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/fleet/servers/${server.id}/kick`, {
        steamid64: kicking.steamid64,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      showSnackbar(t('serversBoard.players.kicked', { name: kicking.name }), 'success');
      setKicking(null);
      setMessage('');
      void load();
    } catch (err) {
      showError(apiErrorMessage(err, t('serversBoard.players.kickFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {t('serversBoard.players.title')}
      </Typography>
      {players.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('serversBoard.players.empty')}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          {players.map((p) => (
            <Box
              key={p.steamid64}
              data-testid={`fleet-player-${p.steamid64}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {p.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t(`serversBoard.players.team.${p.team}`)}
              </Typography>
              <Button
                size="small"
                color="error"
                disabled={!server.online}
                onClick={() => setKicking(p)}
                data-testid={`fleet-kick-${p.steamid64}`}
              >
                {t('serversBoard.players.kick')}
              </Button>
            </Box>
          ))}
        </Box>
      )}
      <Dialog open={kicking !== null} onClose={() => setKicking(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('serversBoard.players.kickTitle', { name: kicking?.name ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('serversBoard.players.kickMessage')}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label={t('serversBoard.players.kickReason')}
            value={message}
            onChange={(e) => setMessage(e.target.value.replace(/[\r\n]/g, ' '))}
            inputProps={{ maxLength: 128 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKicking(null)}>
            {t('serversBoard.close', { defaultValue: 'Close' })}
          </Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void kick()}>
            {t('serversBoard.players.kick')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
