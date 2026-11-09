import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import {
  api,
  apiErrorMessage,
  mono,
  radii,
  tokens,
  useModuleTranslation,
  useSnackbar,
} from '../../../../module-sdk';
import type { RconResultsResponse } from '../../cs2.types';

const { color } = tokens;

/** Commands an admin often wants on a server between matches. */
const QUICK = ['status', 'ru status', 'mp_restartgame 1', 'bot_kick', 'mp_warmup_end'];

/**
 * A server with no match, run by hand: the console, a map change and a chat
 * message. Raw console lines are for root admins and go in the admin log; the
 * API says so when someone else tries.
 */
export function ServerConsole({ serverId, disabled }: { serverId: string; disabled: boolean }) {
  const { t } = useModuleTranslation('cs2');
  const { showError, showSuccess } = useSnackbar();
  const [command, setCommand] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [map, setMap] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      showError(
        apiErrorMessage(error, t('serverConsole.failed', { defaultValue: 'The server refused it' }))
      );
    } finally {
      setBusy(false);
    }
  };

  const exec = () =>
    run(async () => {
      const r = await api.post<RconResultsResponse>('/api/rcon/command', {
        serverIds: [serverId],
        command: 'custom',
        value: command.trim(),
      });
      const one = r.results?.[0];
      if (!one?.success) throw new Error(one?.error || r.error);
      setReply(
        one.response?.trim() ||
          t('serverConsole.noOutput', {
            defaultValue: 'Sent: {{command}} (no output)',
            command: command.trim(),
          })
      );
    });

  const changeMap = () =>
    run(async () => {
      await api.post('/api/rcon/change-map', { serverId, mapName: map.trim() });
      showSuccess(
        t('serverConsole.mapChanged', { defaultValue: 'Changing to {{map}}', map: map.trim() })
      );
    });

  const say = () =>
    run(async () => {
      await api.post('/api/rcon/say', { serverId, message: message.trim() });
      setMessage('');
      showSuccess(t('serverConsole.said', { defaultValue: 'Message sent' }));
    });

  const off = disabled || busy;
  return (
    <Stack gap={1.5} data-testid="server-console">
      <Typography variant="subtitle2">
        {t('serverConsole.title', { defaultValue: 'Server console' })}
      </Typography>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void exec();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          size="small"
          fullWidth
          label={t('serverConsole.command', { defaultValue: 'Console command' })}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={off}
          slotProps={{
            htmlInput: { spellCheck: false, style: mono, 'data-testid': 'server-console-command' },
          }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={off || !command.trim()}
          data-testid="server-console-run"
        >
          {t('serverConsole.run', { defaultValue: 'Run' })}
        </Button>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {QUICK.map((c) => (
          <Button
            key={c}
            size="small"
            variant="outlined"
            disabled={off}
            onClick={() => setCommand(c)}
            sx={{ ...mono, textTransform: 'none' }}
          >
            {c}
          </Button>
        ))}
      </Box>
      {reply !== null && (
        <Box
          component="pre"
          data-testid="server-console-reply"
          sx={{
            ...mono,
            m: 0,
            p: 1.25,
            maxHeight: 240,
            overflow: 'auto',
            fontSize: '0.75rem',
            whiteSpace: 'pre-wrap',
            borderRadius: radii.md,
            bgcolor: color.paper3,
          }}
        >
          {reply}
        </Box>
      )}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void changeMap();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          size="small"
          fullWidth
          label={t('serverConsole.map', { defaultValue: 'Map' })}
          placeholder="de_mirage"
          value={map}
          onChange={(e) => setMap(e.target.value)}
          disabled={off}
          slotProps={{
            htmlInput: { spellCheck: false, style: mono, 'data-testid': 'server-console-map' },
          }}
        />
        <Button
          type="submit"
          variant="outlined"
          disabled={off || !/^[A-Za-z0-9_-]+$/.test(map.trim())}
          sx={{ whiteSpace: 'nowrap' }}
          data-testid="server-console-change-map"
        >
          {t('serverConsole.changeMap', { defaultValue: 'Change map' })}
        </Button>
      </Box>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void say();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          size="small"
          fullWidth
          label={t('serverConsole.message', { defaultValue: 'Message to the server chat' })}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={off}
          slotProps={{ htmlInput: { maxLength: 190, 'data-testid': 'server-console-message' } }}
        />
        <Button
          type="submit"
          variant="outlined"
          disabled={off || !message.trim()}
          data-testid="server-console-say"
        >
          {t('serverConsole.say', { defaultValue: 'Send' })}
        </Button>
      </Box>
    </Stack>
  );
}
