/** Adding a recorder: its key and the command that starts it (Highlights admin). */
/**
 * CS2's part of the Highlights page. Four tabs:
 *
 * - Recorders: every recorder that asked for work, with its GPU, status
 *   (online, recording, paused when its CS2 would not start), its
 *   benchmark, how many clips it kept, seconds per clip, and its recent runs
 *   with their logs (api:
 *   demos/recorders.ts). An offline one can be forgotten.
 * - Clips: recent matches' clips and reels, what each was made at, and a Redo
 *   for each, or for every one made at other settings (api: demos/clipsAdmin.ts).
 * - Overlays: clean copies of the clips, and redrawing their overlays.
 * Adding a recorder is on the Recorders tab: a recorder key and the one
 *   `docker run` that starts it (api: demos/recorderKeys.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';

import { when } from './highlightsAdminShared';

export interface RecorderKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}

/**
 * What a gaming PC runs to become a recorder: the recorder image with the
 * PC's GPU (NVIDIA's when it has one), display, sound, Steam and CS2, this
 * platform's address and a recorder key. It finds CS2 in the PC's Steam
 * libraries itself and shows up under the PC's name (rename it in the list).
 */
export function recorderCommand(origin: string, token: string): string {
  return [
    'docker run -d --name at-recorder --restart unless-stopped \\',
    '  --user "$(id -u):$(id -g)" --group-add "$(getent group video | cut -d: -f3)" \\',
    '  --group-add "$(getent group render | cut -d: -f3)" --device /dev/dri $(command -v nvidia-smi >/dev/null && echo --gpus all) \\',
    '  --ipc=host --net=host --pid=host --shm-size 4g --security-opt seccomp=unconfined --cap-add SYS_NICE \\',
    '  -v "$HOME:$HOME" -v /mnt:/mnt -v /media:/media -v /tmp:/tmp \\',
    '  -v /run/user:/run/user:rslave -e HOME="$HOME" -e XDG_RUNTIME_DIR="/run/user/$(id -u)" \\',
    '  -e WAYLAND_DISPLAY="$WAYLAND_DISPLAY" -e DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \\',
    `  -e AT_URL=${origin} -e AT_WORKER_TOKEN=${token} \\`,
    '  sivertio/auto-tournament-recorder:next',
  ].join('\n');
}

/**
 * What a headless server runs to become a recorder: the platform's own setup
 * scripts (client/public/recorder). The first, with sudo, once: the NVIDIA
 * driver, Docker and no sleep. The second starts CS2's headless Steam desktop
 * and the recorder in it.
 */
export function serverCommands(origin: string, token: string): string {
  return [
    `curl -fsSL ${origin}/recorder/setup-host.sh | sudo bash`,
    `curl -fsSL ${origin}/recorder/start-recorder.sh | AT_URL=${origin} AT_WORKER_TOKEN=${token} bash`,
  ].join('\n');
}

export type RecorderKind = 'pc' | 'server';

/**
 * "Add a recorder": a key made for it, and what to paste, for a gaming PC
 * (one command, from its desktop) or a headless server (two lines). The
 * recorder shows up in the list under its machine's name when it first asks
 * for work. The keys made so far, to revoke.
 */
export function AddRecorder({ onKeys }: { onKeys: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RecorderKind>('pc');
  const [token, setToken] = useState<string | null>(null);
  const [keys, setKeys] = useState<RecorderKey[]>([]);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const loadKeys = useCallback(async () => {
    try {
      setKeys((await api.get<{ keys: RecorderKey[] }>('/api/game/cs2/recorder-keys')).keys);
    } catch {
      setKeys([]);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void loadKeys(), 0);
    return () => clearTimeout(first);
  }, [loadKeys]);

  // The dialog asks for a base name; the key takes it, and each recorder that joins with the
  // key is labelled <name>-1, <name>-2, ... in the order it joins (rename them in the list).
  const [baseName, setBaseName] = useState('recorder');
  const start = () => {
    setOpen(true);
    setToken(null);
  };
  const makeKey = async () => {
    try {
      const res = await api.post<{ token: string }>('/api/game/cs2/recorder-keys', {
        name: baseName.trim() || 'recorder',
      });
      setToken(res.token);
      await loadKeys();
      onKeys();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    }
  };
  const revoke = async (id: string) => {
    try {
      await api.delete(`/api/game/cs2/recorder-keys/${encodeURIComponent(id)}`);
      showSuccess(t('highlightsAdmin.add.revoked'));
      await loadKeys();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    }
  };
  const command = token
    ? kind === 'pc'
      ? recorderCommand(origin, token)
      : serverCommands(origin, token)
    : '';
  const close = () => {
    setOpen(false);
    setToken(null);
  };
  const live = keys.filter((k) => !k.revoked);

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="contained" onClick={() => void start()} data-testid="recorder-add">
          {t('highlightsAdmin.add.button')}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {t('highlightsAdmin.add.hint')}
        </Typography>
      </Stack>
      {live.length > 0 && (
        <Box sx={{ mt: 1.5 }} data-testid="recorder-keys">
          <Typography variant="caption" color="text.secondary">
            {t('highlightsAdmin.add.keys')}
          </Typography>
          {live.map((k) => (
            <Stack
              key={k.id}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ py: 0.5, borderTop: 1, borderColor: 'divider' }}
            >
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {k.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {k.lastUsedAt
                  ? t('highlightsAdmin.add.used', { time: when(k.lastUsedAt) })
                  : t('highlightsAdmin.add.unused')}
              </Typography>
              <Button size="small" color="error" onClick={() => void revoke(k.id)}>
                {t('highlightsAdmin.add.revoke')}
              </Button>
            </Stack>
          ))}
        </Box>
      )}
      <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
        <DialogTitle>{t('highlightsAdmin.add.title')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Tabs value={kind} onChange={(_, v: RecorderKind) => setKind(v)}>
            <Tab value="pc" label={t('highlightsAdmin.add.pc')} data-testid="recorder-add-pc" />
            <Tab
              value="server"
              label={t('highlightsAdmin.add.server')}
              data-testid="recorder-add-server"
            />
          </Tabs>
          <Typography variant="body2">
            {kind === 'pc'
              ? t('highlightsAdmin.add.pcNeeds')
              : t('highlightsAdmin.add.serverNeeds')}
          </Typography>
          {!token ? (
            <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
              <TextField
                size="small"
                label={t('highlightsAdmin.add.baseName')}
                helperText={t('highlightsAdmin.add.baseNameHelp', {
                  name: baseName.trim() || 'recorder',
                })}
                value={baseName}
                onChange={(e) => setBaseName(e.target.value.slice(0, 60))}
                inputProps={{ 'data-testid': 'recorder-base-name' }}
                sx={{ flex: '1 1 16rem' }}
              />
              <Button
                variant="contained"
                onClick={() => void makeKey()}
                data-testid="recorder-make-key"
              >
                {t('highlightsAdmin.add.makeCommand')}
              </Button>
            </Stack>
          ) : (
            <>
              <Box
                component="pre"
                data-testid="recorder-command"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  overflowX: 'auto',
                  fontSize: 12.5,
                }}
              >
                {command}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {kind === 'pc'
                  ? t('highlightsAdmin.add.pcAfter')
                  : t('highlightsAdmin.add.serverAfter')}
              </Typography>
              <Alert severity="info">{t('highlightsAdmin.add.once')}</Alert>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            disabled={!token}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                showSuccess(t('highlightsAdmin.add.copied'));
              } catch {
                showError(t('highlightsAdmin.add.copyFailed'));
              }
            }}
            variant="contained"
            data-testid="recorder-add-copy"
          >
            {t('highlightsAdmin.add.copy')}
          </Button>
          <Button onClick={close}>{t('highlightsAdmin.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
