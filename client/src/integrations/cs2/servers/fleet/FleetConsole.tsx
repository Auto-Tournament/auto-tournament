/** One terminal view on a Ready Up server: live log lines, plus root admins' commands (fleet `exec`, FLEET.md D10). */
import { useEffect, useRef, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { api, mono, useModuleTranslation } from '../../../../module-sdk';
import type { FleetHostServerRef } from '../../cs2.types';
import { useFleetLogs } from './useFleetLogs';

const SECRET_CVAR =
  /((?:^|[\s;+])(?:rcon_password|sv_password|sv_setsteamaccount|readyup_license_key)(?:\s*=\s*|\s+))("[^"]*"|'[^']*'|[^\s;"']+)/gi;
const TOKEN = /\b(?:(?:rus|rfk|rhs|rst)_|RUE-)[\w-]+|\bBearer\s+[\w.~+/=-]+/g;

export function redactCommand(command: string): string {
  return command
    .replace(SECRET_CVAR, (_m, head: string) => `${head}***`)
    .replace(TOKEN, (m) =>
      m.startsWith('Bearer') ? 'Bearer ***' : `${m.slice(0, m.search(/[_-]/) + 1)}***`
    );
}

const ERROR_MARK = '\uE000';

type ExecResponse = { success?: boolean; response?: string; error?: string };

/** Whether the signed-in admin may run console commands (api fleet/console.ts). */
function useIsRoot(): boolean {
  const [root, setRoot] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .get<{ root: boolean }>('/api/fleet/root')
      .then((res) => live && setRoot(res.root))
      .catch(() => live && setRoot(false));
    return () => {
      live = false;
    };
  }, []);
  return root;
}

export function FleetConsole({ server }: { server: FleetHostServerRef }) {
  const { t } = useModuleTranslation('cs2');
  const isRoot = useIsRoot();
  const { lines, live, error, append } = useFleetLogs(server.id, server.online);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const pane = useRef<HTMLElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = pane.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const fail = (text: string) => append(ERROR_MARK + text);

  const send = async () => {
    const command = value.trim();
    if (!command || busy) return;
    setBusy(true);
    append(`> ${redactCommand(command)}`);
    setValue('');
    try {
      const res = await api.post<ExecResponse>(
        `/api/fleet/servers/${encodeURIComponent(server.id)}/exec`,
        { command }
      );
      if (res.success === false) fail(res.error ?? t('serversBoard.console.noOutput'));
      else if (!live) append(res.response || t('serversBoard.console.noOutput'));
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const liveOrOffline = live ? 'live' : 'offline';
  const status = error === 'unsupported' ? 'unsupported' : liveOrOffline;

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {t('serversBoard.console.title')}
      </Typography>
      <Box
        component="pre"
        ref={pane}
        data-testid="fleet-console-output"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        sx={{
          ...mono,
          fontSize: '0.8rem',
          m: 0,
          mb: 1,
          p: 1,
          height: 240,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          bgcolor: 'action.hover',
          borderRadius: 1,
        }}
      >
        {lines.map((line, i) => {
          const isError = line.startsWith(ERROR_MARK);
          return (
            <Box
              key={i}
              component="span"
              sx={{ display: 'block', color: isError ? 'error.main' : undefined }}
            >
              {isError ? line.slice(1) : line}
            </Box>
          );
        })}
      </Box>
      <Typography
        variant="caption"
        color={status === 'live' ? 'success.main' : 'text.secondary'}
        data-testid="fleet-console-status"
        display="block"
        mb={1}
      >
        {t(`serversBoard.console.${status}`)}
      </Typography>
      {isRoot ? (
        <TextField
          fullWidth
          size="small"
          placeholder={t('serversBoard.console.placeholder')}
          value={value}
          disabled={busy || !server.online}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          inputProps={{
            maxLength: 512,
            'data-testid': 'fleet-console-input',
            style: { fontFamily: 'monospace' },
          }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('serversBoard.console.rootOnly')}
        </Typography>
      )}
    </Box>
  );
}
