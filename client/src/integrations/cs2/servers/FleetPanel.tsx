/**
 * The Servers page's "Ready Up fleet" area (FLEET.md §4, platform step 1).
 *
 * Ready Up servers do not get added by address and RCON password: they enroll
 * themselves with a one-time code (Add server) or a reusable fleet key
 * (csm, containers), then hold a WebSocket to `/api/fleet/ws`. This lists
 * them with their online state and versions, and lets an admin create codes
 * and keys (each shown once), rotate a token, revoke a server, and revoke keys.
 * "Use for matches" links an enrolled server to a server row so the
 * allocator hands it matches (`POST /api/fleet/servers/:id/link`), optionally
 * with a connect address set by hand; otherwise players connect to the address
 * the server reports (`public_addr`) or the one its link comes from
 * (`PUT /api/fleet/servers/:id/address` changes it later).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowsClockwiseIcon,
  CopyIcon,
  GlobeIcon,
  KeyIcon,
  LinkBreakIcon,
  LinkIcon,
  PasswordIcon,
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  Row,
  RowList,
  StatusDot,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { FleetKey, FleetKeysResponse, FleetServer, FleetServersResponse } from '../cs2.types';
import { insecureFlag, platformIsPlainHttp } from './insecureLink';
import { ServerSection } from './ServerSection';

const POLL_MS = 10_000;

type Secret = { kind: 'code' | 'key'; value: string; expiresAt: number | null; name: string };
/** The link / connect-address dialog: `link` links the server, `edit` changes a linked server's address. */
type AddressDialog = { mode: 'link' | 'edit'; server: FleetServer; host: string; port: string };
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
  const [keyForm, setKeyForm] = useState({
    name: '',
    namePrefix: '',
    maxServers: '',
    expiresInDays: '',
    autoLink: false,
    skins: false,
  });
  const [addressDialog, setAddressDialog] = useState<AddressDialog | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ server: FleetServer; name: string } | null>(
    null
  );

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

  const renameServer = async () => {
    if (!renameDialog) return;
    const name = renameDialog.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.patch(`/api/fleet/servers/${renameDialog.server.id}`, { name });
      setRenameDialog(null);
      showSnackbar(t('fleetPanel.renamed'), 'success');
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.rename')));
    } finally {
      setBusy(false);
    }
  };

  const createServer = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ code: string; expiresAt: number; server: FleetServer }>(
        '/api/fleet/servers',
        {
          ...(serverName.trim() ? { name: serverName.trim() } : {}),
        }
      );
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
      const res = await api.post<{ code: string; expiresAt: number }>(
        `/api/fleet/servers/${server.id}/code`
      );
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
      if (keyForm.autoLink) body.autoLink = true;
      if (keyForm.skins) body.skins = true;
      const res = await api.post<{ key: FleetKey; value: string }>('/api/fleet/keys', body);
      setKeyOpen(false);
      setKeyForm({ name: '', namePrefix: '', maxServers: '', expiresInDays: '', autoLink: false, skins: false });
      setSecret({
        kind: 'key',
        value: res.value,
        expiresAt: res.key.expiresAt,
        name: res.key.name,
      });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createKey')));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (server: FleetServer) => {
    try {
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(
        `/api/fleet/servers/${server.id}/rotate`
      );
      showSnackbar(
        res.rotation === 'sent' ? t('fleetPanel.rotateSent') : t('fleetPanel.rotateQueued'),
        'success'
      );
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.rotate')));
    }
  };

  const toggleLink = async (server: FleetServer) => {
    if (!server.linkedServerId) {
      setAddressDialog({ mode: 'link', server, host: '', port: '' });
      return;
    }
    try {
      await api.delete(`/api/fleet/servers/${server.id}/link`);
      showSnackbar(
        t('fleetPanel.unlinked', { defaultValue: 'No longer used for matches' }),
        'success'
      );
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    }
  };

  const editAddress = (server: FleetServer) => {
    const own = server.connect?.source === 'override';
    setAddressDialog({
      mode: 'edit',
      server,
      host: own ? (server.connect?.host ?? '') : '',
      port: own ? String(server.connect?.port ?? '') : '',
    });
  };

  /** Link, or save the address; `automatic` clears the override. */
  const saveAddress = async (automatic = false) => {
    if (!addressDialog) return;
    const { mode, server } = addressDialog;
    const host = automatic ? '' : addressDialog.host.trim();
    const port = automatic ? '' : addressDialog.port.trim();
    const body = host ? { host, ...(port ? { port: Number(port) } : {}) } : { host: null };
    setBusy(true);
    try {
      if (mode === 'link') {
        await api.post(`/api/fleet/servers/${server.id}/link`, host ? body : {});
        showSnackbar(t('fleetPanel.linked', { defaultValue: 'Used for matches' }), 'success');
      } else {
        await api.put(`/api/fleet/servers/${server.id}/address`, body);
        showSnackbar(
          t('fleetPanel.addressSaved', { defaultValue: 'Connect address saved' }),
          'success'
        );
      }
      setAddressDialog(null);
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = (connect: FleetServer['connect']): string => {
    switch (connect?.source) {
      case 'override':
        return t('fleetPanel.connectSource.override', { defaultValue: 'set by an admin' });
      case 'public_addr':
        return t('fleetPanel.connectSource.publicAddr', { defaultValue: 'reported by the server' });
      case 'machine':
        return t('fleetPanel.connectSource.machine', { defaultValue: 'the address of the machine it runs on' });
      case 'peer':
        return t('fleetPanel.connectSource.peer', {
          defaultValue: 'address the server connects from',
        });
      default:
        return t('fleetPanel.connectSource.unknown', {
          defaultValue: 'not confirmed by the server yet',
        });
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'revoke')
        await api.post(`/api/fleet/servers/${pending.server.id}/revoke`);
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
    <ServerSection
      id="fleet"
      data-testid="fleet-panel"
      title={t('fleetPanel.title')}
      summary={t('fleetPanel.summary', {
        defaultValue: '{{servers}} Ready Up server(s), {{online}} online · {{keys}} fleet key(s)',
        servers: servers.length,
        online: servers.filter((sv) => sv.online).length,
        keys: liveKeys.length,
      })}
      about={t('fleetPanel.description')}
      action={
        <Stack direction="row" gap={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<KeyIcon />}
            onClick={() => setKeyOpen(true)}
          >
            {t('fleetPanel.createKey')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<PlusIcon />}
            onClick={() => setAddOpen(true)}
            data-testid="fleet-add-server"
          >
            {t('fleetPanel.addServer')}
          </Button>
        </Stack>
      }
    >
      {loaded && servers.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="fleet-empty">
          {t('fleetPanel.empty')}
        </Typography>
      ) : (
        <RowList data-testid="fleet-servers">
          {servers.map((server) => (
            <Row
              key={server.id}
              columns={{
                xs: 'auto minmax(0, 1fr)',
                md: 'auto minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto',
              }}
              data-testid={`fleet-server-${server.id}`}
            >
              <StatusDot state={statusDot(server)} />
              <Box minWidth={0}>
                <Typography fontWeight={600} noWrap>
                  {server.name}
                </Typography>
                {server.connect ? (
                  <Tooltip title={sourceLabel(server.connect)}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={mono}
                      noWrap
                      display="block"
                      data-testid={`fleet-connect-${server.id}`}
                    >
                      {`connect ${server.connect.address}`}
                      {server.connect.source === 'override' ? ' *' : ''}
                    </Typography>
                  </Tooltip>
                ) : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={mono}
                    noWrap
                    display="block"
                  >
                    {server.host ? `${server.host.hostname}:${server.host.game_port}` : server.id}
                  </Typography>
                )}
                {server.connect?.source === 'peer' && (
                  <Typography
                    variant="caption"
                    color="warning.main"
                    display="block"
                    data-testid={`fleet-connect-guessed-${server.id}`}
                  >
                    {t('fleetPanel.connectGuessed', {
                      defaultValue: 'Guessed from where the server connects from. Check it, or set the address players use.',
                    })}
                  </Typography>
                )}
              </Box>
              <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                <Chip
                  size="small"
                  label={t(
                    `fleetPanel.status.${server.status === 'enrolled' ? (server.online ? 'online' : 'offline') : server.status}`
                  )}
                  color={
                    server.status === 'revoked' ? 'error' : server.online ? 'success' : 'default'
                  }
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
                    {server.readyUpUpdate?.state === 'outdated' ? (
                      <Typography variant="caption" color="warning.main" display="block">
                        {t('fleetPanel.updateAvailable', {
                          version: server.readyUpUpdate.latest,
                          defaultValue: 'Update available: {{version}}',
                        })}
                      </Typography>
                    ) : server.readyUpUpdate?.state === 'current' ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('fleetPanel.upToDate', { defaultValue: 'Up to date' })}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('fleetPanel.noUpdateCheck', { defaultValue: 'No update check yet' })}
                      </Typography>
                    )}
                    {server.versions.cs2_build !== undefined && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={mono}
                        display="block"
                      >
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
              <Stack
                direction="row"
                gap={0.5}
                justifyContent="flex-end"
                gridColumn={{ xs: '1 / -1', md: 'auto' }}
              >
                {server.status === 'pending' && (
                  <Tooltip title={t('fleetPanel.newCode')}>
                    <IconButton
                      size="small"
                      onClick={() => void newCode(server)}
                      aria-label={t('fleetPanel.newCode')}
                    >
                      <PasswordIcon size={20} />
                    </IconButton>
                  </Tooltip>
                )}
                {server.status === 'enrolled' && (
                  <>
                    <Tooltip
                      title={
                        server.linkedServerId
                          ? t('fleetPanel.unlink', { defaultValue: 'Stop using for matches' })
                          : t('fleetPanel.link', { defaultValue: 'Use for matches' })
                      }
                    >
                      <IconButton
                        size="small"
                        color={server.linkedServerId ? 'primary' : 'default'}
                        onClick={() => void toggleLink(server)}
                        aria-label={
                          server.linkedServerId
                            ? t('fleetPanel.unlink', { defaultValue: 'Stop using for matches' })
                            : t('fleetPanel.link', { defaultValue: 'Use for matches' })
                        }
                        data-testid={`fleet-link-${server.id}`}
                      >
                        {server.linkedServerId ? (
                          <LinkIcon size={20} />
                        ) : (
                          <LinkBreakIcon size={20} />
                        )}
                      </IconButton>
                    </Tooltip>
                    {server.linkedServerId && (
                      <Tooltip
                        title={t('fleetPanel.connectAddress', { defaultValue: 'Connect address' })}
                      >
                        <IconButton
                          size="small"
                          onClick={() => editAddress(server)}
                          aria-label={t('fleetPanel.connectAddress', {
                            defaultValue: 'Connect address',
                          })}
                          data-testid={`fleet-address-${server.id}`}
                        >
                          <GlobeIcon size={20} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip
                      title={
                        server.token
                          ? t('fleetPanel.rotateTooltip', {
                              time: when(server.token.rotationDueAt, locale),
                            })
                          : t('fleetPanel.rotate')
                      }
                    >
                      <IconButton
                        size="small"
                        onClick={() => void rotate(server)}
                        aria-label={t('fleetPanel.rotate')}
                      >
                        <ArrowsClockwiseIcon size={20} />
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
                        <ProhibitIcon size={20} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                <Tooltip title={t('fleetPanel.rename')}>
                  <IconButton
                    size="small"
                    onClick={() => setRenameDialog({ server, name: server.name })}
                    aria-label={t('fleetPanel.rename')}
                    data-testid={`fleet-rename-${server.id}`}
                  >
                    <PencilSimpleIcon size={20} />
                  </IconButton>
                </Tooltip>
                {server.status !== 'enrolled' && (
                  <Tooltip title={t('fleetPanel.remove')}>
                    <IconButton
                      size="small"
                      onClick={() => setPending({ action: 'remove', server })}
                      aria-label={t('fleetPanel.remove')}
                    >
                      <TrashIcon size={20} />
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
            <Row
              key={key.id}
              columns={{ xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}
            >
              <Box minWidth={0}>
                <Typography fontWeight={600} noWrap>
                  {key.name}
                  {key.locked && (
                    <Chip
                      size="small"
                      color="warning"
                      label={t('fleetPanel.keyLocked')}
                      sx={{ ml: 1 }}
                    />
                  )}
                  {key.autoLink && (
                    <Chip size="small" label={t('fleetPanel.keyAutoLink')} sx={{ ml: 1 }} />
                  )}
                  {key.skins && (
                    <Chip size="small" label={t('fleetPanel.keySkinsChip')} sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={mono}>
                  rfk_{key.id}_…
                </Typography>
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                display={{ xs: 'none', md: 'block' }}
              >
                {key.maxServers
                  ? t('fleetPanel.keyUsageLimited', { n: key.enrolledServers, max: key.maxServers })
                  : t('fleetPanel.keyUsage', { count: key.enrolledServers })}
                {key.namePrefix
                  ? ` · ${t('fleetPanel.keyPrefix', { prefix: key.namePrefix })}`
                  : ''}
                {key.expiresAt
                  ? ` · ${t('fleetPanel.keyExpires', { time: when(key.expiresAt, locale) })}`
                  : ''}
              </Typography>
              <Tooltip title={t('fleetPanel.revokeKey')}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setPending({ action: 'revokeKey', key })}
                  aria-label={t('fleetPanel.revokeKey')}
                >
                  <ProhibitIcon size={20} />
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
          <Button
            variant="contained"
            onClick={() => void createServer()}
            disabled={busy}
            data-testid="fleet-create-code"
          >
            {t('fleetPanel.createCode')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename */}
      <Dialog
        open={renameDialog !== null}
        onClose={() => setRenameDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('fleetPanel.rename')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            label={t('fleetPanel.serverName')}
            value={renameDialog?.name ?? ''}
            onChange={(e) =>
              renameDialog && setRenameDialog({ ...renameDialog, name: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') void renameServer();
            }}
            inputProps={{ maxLength: 100, 'data-testid': 'fleet-rename-input' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => void renameServer()}
            disabled={busy || !renameDialog?.name.trim()}
            data-testid="fleet-rename-save"
          >
            {t('fleetPanel.renameSave')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Use for matches / connect address */}
      <Dialog
        open={addressDialog !== null}
        onClose={() => setAddressDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {addressDialog?.mode === 'link'
            ? t('fleetPanel.link', { defaultValue: 'Use for matches' })
            : t('fleetPanel.connectAddress', { defaultValue: 'Connect address' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPanel.addressHelp', {
              defaultValue:
                'Players connect to this address. Leave it empty to use the address the server reports, or the one it connects from.',
            })}
          </Typography>
          {addressDialog && (
            <Typography variant="body2" sx={mono} mb={2} data-testid="fleet-address-detected">
              {addressDialog.server.connect
                ? `${t('fleetPanel.addressCurrent', { defaultValue: 'Now' })}: connect ${addressDialog.server.connect.address} (${sourceLabel(addressDialog.server.connect)})`
                : t('fleetPanel.addressNone', {
                    defaultValue: 'No address detected yet: the server has not connected.',
                  })}
            </Typography>
          )}
          <Stack direction="row" gap={1}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label={t('fleetPanel.addressHost', { defaultValue: 'Host or IP' })}
              placeholder={addressDialog?.server.connect?.host ?? ''}
              value={addressDialog?.host ?? ''}
              onChange={(e) =>
                addressDialog && setAddressDialog({ ...addressDialog, host: e.target.value })
              }
              inputProps={{ maxLength: 253, 'data-testid': 'fleet-address-host' }}
            />
            <TextField
              size="small"
              type="number"
              label={t('fleetPanel.addressPort', { defaultValue: 'Port' })}
              placeholder={String(
                addressDialog?.server.connect?.port ?? addressDialog?.server.host?.game_port ?? ''
              )}
              value={addressDialog?.port ?? ''}
              onChange={(e) =>
                addressDialog && setAddressDialog({ ...addressDialog, port: e.target.value })
              }
              inputProps={{ min: 1, max: 65535, 'data-testid': 'fleet-address-port' }}
              sx={{ width: 120 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressDialog(null)}>{t('common.cancel')}</Button>
          {addressDialog?.mode === 'edit' &&
            addressDialog.server.connect?.source === 'override' && (
              <Button onClick={() => void saveAddress(true)} disabled={busy}>
                {t('fleetPanel.addressAutomatic', { defaultValue: 'Use detected address' })}
              </Button>
            )}
          <Button
            variant="contained"
            onClick={() => void saveAddress()}
            disabled={busy || (addressDialog?.mode === 'edit' && !addressDialog.host.trim())}
            data-testid="fleet-address-save"
          >
            {addressDialog?.mode === 'link'
              ? t('fleetPanel.link', { defaultValue: 'Use for matches' })
              : t('common.save', { defaultValue: 'Save' })}
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
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={keyForm.autoLink}
                  onChange={(e) => setKeyForm({ ...keyForm, autoLink: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('fleetPanel.keyAutoLinkLabel')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('fleetPanel.keyAutoLinkHelp')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={keyForm.skins}
                  onChange={(e) => setKeyForm({ ...keyForm, skins: e.target.checked })}
                  data-testid="fleet-key-skins"
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('fleetPanel.keySkins')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('fleetPanel.keySkinsHelp')}
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKeyOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => void createKey()}
            disabled={busy || !keyForm.name.trim()}
          >
            {t('fleetPanel.createKey')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* A code or key, shown once */}
      <Dialog open={secret !== null} onClose={() => setSecret(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {secret?.kind === 'key'
            ? t('fleetPanel.keyCreatedTitle')
            : t('fleetPanel.codeCreatedTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {secret?.kind === 'key'
              ? t('fleetPanel.keyCreatedHelp', { name: secret?.name })
              : t('fleetPanel.codeCreatedHelp', {
                  name: secret?.name,
                  time: when(secret?.expiresAt, locale),
                })}
          </Typography>
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              ...mono,
              wordBreak: 'break-all',
            }}
          >
            <Box flex={1} data-testid="fleet-secret">
              {secret?.value}
            </Box>
            <IconButton
              size="small"
              onClick={() => secret && void copy(secret.value)}
              aria-label={t('fleetPanel.copy')}
            >
              <CopyIcon size={20} />
            </IconButton>
          </Box>
          <Typography variant="caption" color="warning.main" display="block" mt={1.5}>
            {t('fleetPanel.shownOnce')}
          </Typography>
          {secret?.kind === 'code' && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="pre"
              sx={{ ...mono, mt: 1.5, whiteSpace: 'pre-wrap' }}
            >
              {`ru fleet enroll ${window.location.origin} ${secret.value}${insecureFlag()}`}
            </Typography>
          )}
          {secret?.kind === 'code' && platformIsPlainHttp() && (
            <Typography
              variant="caption"
              color="warning.main"
              display="block"
              mt={1}
              data-testid="fleet-insecure-note"
            >
              {t('fleetPanel.insecureNote')}
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
    </ServerSection>
  );
}
