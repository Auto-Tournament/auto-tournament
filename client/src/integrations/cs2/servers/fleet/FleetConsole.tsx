/** One console line on a Ready Up server (`cmd exec`, root admins only, api fleet/console.ts). */
import { useEffect, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { api, apiErrorMessage, mono, useModuleTranslation } from '../../../../module-sdk';
import type { FleetHostServerRef } from '../../cs2.types';

interface Line {
  command: string;
  output: string;
  failed: boolean;
}

export function FleetConsole({ server }: { server: FleetHostServerRef }) {
  const { t } = useModuleTranslation('cs2');
  const [root, setRoot] = useState(false);
  const [value, setValue] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

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

  if (!root) return null;

  const send = async () => {
    const command = value.trim();
    if (!command || busy) return;
    setBusy(true);
    let line: Line;
    try {
      const res = await api.post<{ success: boolean; response?: string }>(
        `/api/fleet/servers/${server.id}/exec`,
        { command }
      );
      line = {
        command,
        output: res.response || t('serversBoard.console.noOutput'),
        failed: !res.success,
      };
      setValue('');
    } catch (err) {
      line = {
        command,
        output: apiErrorMessage(err, t('serversBoard.console.noOutput')),
        failed: true,
      };
    } finally {
      setBusy(false);
    }
    setLines((prev) => [...prev, line].slice(-20));
  };

  return (
    <Box data-testid="fleet-console">
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {t('serversBoard.console.title')}
      </Typography>
      {lines.length > 0 && (
        <Box
          component="pre"
          data-testid="fleet-console-output"
          sx={{
            ...mono,
            fontSize: '0.8rem',
            m: 0,
            mb: 1,
            p: 1,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            bgcolor: 'action.hover',
            borderRadius: 1,
          }}
        >
          {lines.map((l, i) => (
            <Box
              key={i}
              component="span"
              sx={{ display: 'block', color: l.failed ? 'error.main' : undefined }}
            >
              {`> ${l.command}\n${l.output}`}
            </Box>
          ))}
        </Box>
      )}
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
    </Box>
  );
}
