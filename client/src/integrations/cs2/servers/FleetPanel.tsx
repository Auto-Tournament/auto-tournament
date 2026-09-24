/**
 * The Servers page's "Ready Up fleet" area (FLEET.md §4, platform step 1).
 *
 * Ready Up servers do not get added by address and RCON password: they enroll
 * themselves with a one-time code (Add server) or a reusable fleet key
 * (csm, containers), then hold a WebSocket to `/api/fleet/ws`. This lists
 * them with their online state and versions, and lets an admin create codes
 * and keys (each shown once), rotate a token, revoke a server, and revoke keys.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import BlockIcon from '@mui/icons-material/Block';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PinIcon from '@mui/icons-material/Pin';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  Row,
  RowList,
  SectionHead,
  StatusDot,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { FleetKey, FleetKeysResponse, FleetServer, FleetServersResponse } from '../cs2.types';

const POLL_MS = 10_000;

type Secret = { kind: 'code' | 'key'; value: string; expiresAt: number | null; name: string };
type Pending =
  | { action: 'revoke'; server: FleetServer }
  | { action: 'remove'; server: FleetServer }
  | { action: 'revokeKey'; key: FleetKey };

function when(unixSeconds: number | null | undefined, locale: string): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString(locale);
}

function statusDot(server: FleetServer): 'live' | 'free' | 'loading' | 'error' {
  if (server.status === 'revoked') return 'error';
  if (server.status === 'pending') return 'loading';
  return server.online ? 'live' : 'free';
}

export default function FleetPanel() {
  const { t, i18n } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [servers, setServers] = useState<FleetServer[]>([]);
  const [keys, setKeys] = useState<FleetKey[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverName, setServerName] = useState('');
  const [keyForm, setKeyForm] = useState({ name: '', namePrefix: '', maxServers: '', expiresInDays: '' });

  const load = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([
        api.get<FleetServersResponse>('/api/fleet/servers'),
        api.get<FleetKeysResponse>('/api/fleet/keys'),
      ]);
      setServers(s.servers || []);
      setKeys(k.keys || []);
    } catch (err) {
      console.error('Failed to load the fleet', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSnackbar(t('fleetPanel.copied'), 'success');
    } catch {
      showError(t('fleetPanel.copyFailed'));
    }
  };

  const createServer = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ code: string; expiresAt: number; server: FleetServer }>('/api/fleet/servers', {
        ...(serverName.trim() ? { name: serverName.trim() } : {}),
      });
      setAddOpen(false);
      setServerName('');
      setSecret({ kind: 'code', value: res.code, expiresAt: res.expiresAt, name: res.server.name });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createServer')));
    } finally {
      setBusy(false);
    }
  };

  const newCode = async (server: FleetServer) => {
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(`/api/fleet/servers/${server.id}/code`);
      setSecret({ kind: 'code', value: res.code, expiresAt: res.expiresAt, name: server.name });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createServer')));
    }
  };

  const createKey = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: keyForm.name.trim() };
      if (keyForm.namePrefix.trim()) body.namePrefix = keyForm.namePrefix.trim();
      if (keyForm.maxServers.trim()) body.maxServers = Number(keyForm.maxServers);
      if (keyForm.expiresInDays.trim()) body.expiresInDays = Number(keyForm.expiresInDays);
      const res = await api.post<{ key: FleetKey; value: string }>('/api/fleet/keys', body);
      setKeyOpen(false);
      setKeyForm({ name: '', namePrefix: '', maxServers: '', expiresInDays: '' });
      setSecret({ kind: 'key', value: res.value, expiresAt: res.key.expiresAt, name: res.key.name });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createKey')));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (server: FleetServer) => {
    try {
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(`/api/fleet/servers/${server.id}/rotate`);
      showSnackbar(
        res.rotation === 'sent' ? t('fleetPanel.rotateSent') : t('fleetPanel.rotateQueued'),
        'success'
      );
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.rotate')));
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'revoke') await api.post(`/api/fleet/servers/${pending.server.id}/revoke`);
      if (pending.action === 'remove') await api.delete(`/api/fleet/servers/${pending.server.id}`);
      if (pending.action === 'revokeKey') await api.delete(`/api/fleet/keys/${pending.key.id}`);
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const locale = i18n.language;
  const liveKeys = keys.filter((k) => !k.revoked);

  return (
    <Box data-testid="fleet-panel" mt={4}>
      <SectionHead
        title={t('fleetPanel.title')}
        action={
          <Stack direction="row" gap={1}>
            <Button size="small" variant="outlined" startIcon={<VpnKeyIcon />} onClick={() => setKeyOpen(true)}>
              {t('fleetPanel.createKey')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setAddOpen(true)}
              data-testid="fleet-add-server"
            >
              {t('fleetPanel.addServer')}
            </Button>
          </Stack>
        }
      />
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('fleetPanel.description')}
      </Typography>

      {loaded && servers.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="fleet-empty">
          {t('fleetPanel.empty')}
        </Typography>
      ) : (
        <RowList data-testid="fleet-servers">
          {servers.map((server) => (
            <Row
              key={server.id}
              columns={{ xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto' }}
              data-testid={`fleet-server-${server.id}`}
            >
              <StatusDot state={statusDot(server)} />
              <Box minWidth={0}>
                <Typography fontWeight={600} noWrap>
                  {server.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={mono} noWrap display="block">
                  {server.host ? `${server.host.hostname}:${server.host.game_port}` : server.id}
                </Typography>
              </Box>
              <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                <Chip
                  size="small"
                  label={t(`fleetPanel.status.${server.status === 'enrolled' ? (server.online ? 'online' : 'offline') : server.status}`)}
                  color={server.status === 'revoked' ? 'error' : server.online ? 'success' : 'default'}
                  variant={server.online ? 'filled' : 'outlined'}
                />
                {server.status === 'pending' && server.codeExpiresAt && (
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    {t('fleetPanel.codeExpires', { time: when(server.codeExpiresAt, locale) })}
                  </Typography>
                )}
                {server.status === 'enrolled' && !server.online && server.lastSeen !== null && (
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    {t('fleetPanel.lastSeen', { time: when(server.lastSeen, locale) })}
                  </Typography>
                )}
              </Box>
              <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                {server.versions ? (
                  <>
                    <Typography variant="body2" sx={mono} noWrap>
                      {t('fleetPanel.readyUpVersion', { version: server.versions.core })}
                    </Typography>
                    {server.versions.cs2_build !== undefined && (
                      <Typography variant="caption" color="text.secondary" sx={mono} display="block">
                        {t('fleetPanel.cs2Build', { build: server.versions.cs2_build })}
                      </Typography>
                    )}
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    —
                  </Typography>
                )}
              </Box>
              <Stack direction="row" gap={0.5} justifyContent="flex-end" gridColumn={{ xs: '1 / -1', md: 'auto' }}>
                {server.status === 'pending' && (
                  <Tooltip title={t('fleetPanel.newCode')}>
                    <IconButton size="small" onClick={() => void newCode(server)} aria-label={t('fleetPanel.newCode')}>
                      <PinIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {server.status === 'enrolled' && (
                  <>
                    <Tooltip
                      title={
                        server.token
                          ? t('fleetPanel.rotateTooltip', { time: when(server.token.rotationDueAt, locale) })
                          : t('fleetPanel.rotate')
                      }
                    >
                      <IconButton size="small" onClick={() => void rotate(server)} aria-label={t('fleetPanel.rotate')}>
                        <AutorenewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('fleetPanel.revoke')}>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setPending({ action: 'revoke', server })}
                        aria-label={t('fleetPanel.revoke')}
                        data-testid={`fleet-revoke-${server.id}`}
                      >
                        <BlockIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                {server.status !== 'enrolled' && (
                  <Tooltip title={t('fleetPanel.remove')}>
                    <IconButton
                      size="small"
                      onClick={() => setPending({ action: 'remove', server })}
                      aria-label={t('fleetPanel.remove')}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Row>
          ))}
        </RowList>
      )}

      <Typography variant="subtitle2" fontWeight={600} mt={3} mb={1}>
        {t('fleetPanel.keysTitle')}
      </Typography>
      {liveKeys.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('fleetPanel.keysEmpty')}
        </Typography>
      ) : (
        <RowList data-testid="fleet-keys">
          {liveKeys.map((key) => (
            <Row key={key.id} columns={{ xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}>
              <Box minWidth={0}>
                <Typography fontWeight={600} noWrap>
                  {key.name}
                  {key.locked && (
                    <Chip size="small" color="warning" label={t('fleetPanel.keyLocked')} sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={mono}>
                  rfk_{key.id}_…
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" display={{ xs: 'none', md: 'block' }}>
                {key.maxServers
                  ? t('fleetPanel.keyUsageLimited', { n: key.enrolledServers, max: key.maxServers })
                  : t('fleetPanel.keyUsage', { n: key.enrolledServers })}
                {key.namePrefix ? ` · ${t('fleetPanel.keyPrefix', { prefix: key.namePrefix })}` : ''}
                {key.expiresAt ? ` · ${t('fleetPanel.keyExpires', { time: when(key.expiresAt, locale) })}` : ''}
              </Typography>
              <Tooltip title={t('fleetPanel.revokeKey')}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setPending({ action: 'revokeKey', key })}
                  aria-label={t('fleetPanel.revokeKey')}
                >
                  <BlockIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Row>
          ))}
        </RowList>
      )}

      {/* Add server: a pending record and its one-time code */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('fleetPanel.addServer')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPanel.addServerHelp')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('fleetPanel.serverName')}
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            inputProps={{ maxLength: 100 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void createServer()} disabled={busy} data-testid="fleet-create-code">
            {t('fleetPanel.createCode')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create fleet key */}
      <Dialog open={keyOpen} onClose={() => setKeyOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('fleetPanel.createKey')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPanel.createKeyHelp')}
          </Typography>
          <Stack gap={2}>
            <TextField
              autoFocus
              required
              size="small"
              label={t('fleetPanel.keyName')}
              value={keyForm.name}
              onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
              inputProps={{ maxLength: 100 }}
            />
            <TextField
              size="small"
              label={t('fleetPanel.keyNamePrefix')}
              value={keyForm.namePrefix}
              onChange={(e) => setKeyForm({ ...keyForm, namePrefix: e.target.value })}
              inputProps={{ maxLength: 40 }}
            />
            <TextField
              size="small"
              type="number"
              label={t('fleetPanel.keyMaxServers')}
              value={keyForm.maxServers}
              onChange={(e) => setKeyForm({ ...keyForm, maxServers: e.target.value })}
              inputProps={{ min: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label={t('fleetPanel.keyExpiresInDays')}
              value={keyForm.expiresInDays}
              onChange={(e) => setKeyForm({ ...keyForm, expiresInDays: e.target.value })}
              inputProps={{ min: 1 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKeyOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void createKey()} disabled={busy || !keyForm.name.trim()}>
            {t('fleetPanel.createKey')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* A code or key, shown once */}
      <Dialog open={secret !== null} onClose={() => setSecret(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{secret?.kind === 'key' ? t('fleetPanel.keyCreatedTitle') : t('fleetPanel.codeCreatedTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {secret?.kind === 'key'
              ? t('fleetPanel.keyCreatedHelp', { name: secret?.name })
              : t('fleetPanel.codeCreatedHelp', { name: secret?.name, time: when(secret?.expiresAt, locale) })}
          </Typography>
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', ...mono, wordBreak: 'break-all' }}
          >
            <Box flex={1} data-testid="fleet-secret">
              {secret?.value}
            </Box>
            <IconButton size="small" onClick={() => secret && void copy(secret.value)} aria-label={t('fleetPanel.copy')}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography variant="caption" color="warning.main" display="block" mt={1.5}>
            {t('fleetPanel.shownOnce')}
          </Typography>
          {secret?.kind === 'code' && (
            <Typography variant="caption" color="text.secondary" component="pre" sx={{ ...mono, mt: 1.5, whiteSpace: 'pre-wrap' }}>
              {`ru fleet enroll ${window.location.origin} ${secret.value}`}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setSecret(null)}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'revokeKey'
            ? t('fleetPanel.confirm.revokeKeyTitle')
            : pending?.action === 'remove'
              ? t('fleetPanel.confirm.removeTitle')
              : t('fleetPanel.confirm.revokeTitle')
        }
        message={
          pending?.action === 'revokeKey'
            ? t('fleetPanel.confirm.revokeKeyMessage', { name: pending.key.name })
            : pending?.action === 'remove'
              ? t('fleetPanel.confirm.removeMessage', { name: pending.server.name })
              : t('fleetPanel.confirm.revokeMessage', { name: pending?.server.name ?? '' })
        }
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </Box>
  );
}
