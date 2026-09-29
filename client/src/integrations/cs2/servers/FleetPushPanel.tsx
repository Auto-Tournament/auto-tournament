/**
 * The Servers page's "Fleet settings" area: what the platform pushes to Ready
 * Up servers outside a match (FLEET.md §7.4, §7.5).
 *
 * - In-game admins (`admins.set`): the website's admins plus extra in-game
 *   admins, one fleet-wide list with a rev; each server's copy and whether it
 *   acked it.
 * - Settings (`server.config` + `settings.set`): a fleet default and a
 *   per-server override.
 * - Per server: whitelist, practice mode and plugins (`cmd`), each with the
 *   server's last answer. Plugins are picked as a set (PluginSetPicker), and
 *   the fleet default set goes to servers csm creates.
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
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowsClockwiseIcon,
  GearIcon,
  ListChecksIcon,
  PuzzlePieceIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  mono,
  Row,
  RowList,
  SectionHead,
  StatusDot,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { FleetServer, FleetServersResponse } from '../cs2.types';
import FleetSettingsDialog from './FleetSettingsDialog';
import PluginSetPicker, { presetValue, usePluginCatalog } from './PluginSetPicker';
import type {
  FleetAdminsResponse,
  FleetCommandAnswer,
  FleetPushStatus,
  FleetServerPushResponse,
  FleetSettingsResponse,
  FleetSettingsValue,
  PluginCatalogResponse,
  PluginSetValue,
  PluginsState,
} from './fleetPush.types';

const POLL_MS = 10_000;

type Dialogs =
  | { kind: 'defaults' }
  | { kind: 'override'; server: FleetServer }
  | { kind: 'whitelist'; server: FleetServer }
  | { kind: 'plugins'; server: FleetServer }
  | { kind: 'extras' }
  | { kind: 'defaultPlugins' }
  | null;

/** "steamid64 name" per line → entries; bad lines are reported. */
export function parseAdminLines(text: string): {
  admins: { steamid64: string; name: string }[];
  bad: string[];
} {
  const admins: { steamid64: string; name: string }[] = [];
  const bad: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^(\d{17})(?:[\s,;]+(.*))?$/.exec(trimmed);
    if (!m) bad.push(trimmed);
    else admins.push({ steamid64: m[1], name: (m[2] ?? '').trim() });
  }
  return { admins, bad };
}

/**
 * The set a server's Plugins dialog starts from: the set it was given, else
 * what its hello says is on, else the fleet default, else Tournament.
 */
export function initialPluginSet(
  catalog: PluginCatalogResponse,
  given: PluginSetValue | null | undefined,
  state: PluginsState | null | undefined
): PluginSetValue {
  if (given) return given;
  if (state) {
    const on = catalog.catalog.filter(
      (p) =>
        catalog.required.includes(p) || (state.installed.includes(p) && !state.disabled.includes(p))
    );
    const preset = (['tournament', 'practice', 'fun'] as const).find(
      (x) =>
        catalog.presets[x].length === on.length && catalog.presets[x].every((p) => on.includes(p))
    );
    return { preset: preset ?? 'custom', plugins: on };
  }
  return catalog.default ?? presetValue(catalog, 'tournament');
}

function StatusChip({ status, label }: { status: FleetPushStatus | null; label: string }) {
  const { t } = useModuleTranslation('cs2');
  if (!status) return null;
  let text: string;
  let color: 'default' | 'success' | 'warning' | 'error' = 'default';
  if (status.status) {
    text = t(`fleetPush.status.${status.status}`, { defaultValue: status.status });
    if (status.status === 'ok') color = 'success';
    else if (status.status === 'pending') color = 'default';
    else color = status.status === 'rejected' ? 'warning' : 'error';
  } else {
    text = status.acked
      ? t('fleetPush.status.acked', { defaultValue: 'acked' })
      : t('fleetPush.status.queued', { defaultValue: 'queued' });
    color = status.acked ? 'success' : 'default';
  }
  const detail = [status.errorCode, status.message].filter(Boolean).join(': ');
  return (
    <Tooltip title={detail || (status.rev !== null ? `rev ${status.rev}` : '')}>
      <Chip
        size="small"
        variant="outlined"
        color={color}
        label={`${label}: ${text}`}
        sx={{ mr: 0.5, mb: 0.5 }}
      />
    </Tooltip>
  );
}

export default function FleetPushPanel() {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [servers, setServers] = useState<FleetServer[]>([]);
  const [admins, setAdmins] = useState<FleetAdminsResponse | null>(null);
  const [defaults, setDefaults] = useState<FleetSettingsResponse | null>(null);
  const [pushState, setPushState] = useState<Record<string, FleetServerPushResponse>>({});
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [whitelistEnabled, setWhitelistEnabled] = useState(true);
  const [pluginSet, setPluginSet] = useState<PluginSetValue | null>(null);
  const { catalog, reload: reloadCatalog } = usePluginCatalog();

  const load = useCallback(async () => {
    try {
      const [s, a, d] = await Promise.all([
        api.get<FleetServersResponse>('/api/fleet/servers'),
        api.get<FleetAdminsResponse>('/api/fleet/admins'),
        api.get<FleetSettingsResponse>('/api/fleet/settings'),
      ]);
      const enrolled = (s.servers || []).filter((x) => x.status === 'enrolled');
      setServers(enrolled);
      setAdmins(a);
      setDefaults(d);
      const states = await Promise.all(
        enrolled.map((x) =>
          api.get<FleetServerPushResponse>(`/api/fleet/servers/${x.id}/push`).catch(() => null)
        )
      );
      const map: Record<string, FleetServerPushResponse> = {};
      for (const st of states) if (st) map[st.serverId] = st;
      setPushState(map);
    } catch (err) {
      console.error('Failed to load the fleet settings', err);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, what));
    } finally {
      setBusy(false);
    }
  };

  const answered = (res: FleetCommandAnswer, okText: string) => {
    const c = res.command;
    if (c.status === 'ok') showSnackbar(okText, 'success');
    else if (c.status === 'pending')
      showSnackbar(
        c.delivered
          ? t('fleetPush.sentNoAnswer', { defaultValue: 'Sent; no answer yet' })
          : t('fleetPush.queuedOffline', {
              defaultValue: 'Queued: the server gets it when it reconnects',
            }),
        'info'
      );
    else showError(`${c.errorCode ?? c.status}${c.message ? `: ${c.message}` : ''}`);
  };

  const saveDefaults = (value: FleetSettingsValue) =>
    run(t('fleetPush.errors.save', { defaultValue: 'Saving the settings failed' }), async () => {
      const res = await api.put<{ rev: number; pushed: number }>('/api/fleet/settings', {
        settings: value,
      });
      showSnackbar(
        t('fleetPush.savedDefaults', {
          count: res.pushed,
          defaultValue: 'Saved; pushed to {{count}} server(s)',
        }),
        'success'
      );
      setDialog(null);
    });

  const saveOverride = (server: FleetServer, value: FleetSettingsValue | null) =>
    run(t('fleetPush.errors.save', { defaultValue: 'Saving the settings failed' }), async () => {
      await api.put(`/api/fleet/servers/${server.id}/settings`, { settings: value });
      showSnackbar(
        t('fleetPush.savedServer', {
          name: server.name,
          defaultValue: 'Saved and pushed to {{name}}',
        }),
        'success'
      );
      setDialog(null);
    });

  const pushSettingsNow = (server: FleetServer) =>
    run(t('fleetPush.errors.push', { defaultValue: 'Push failed' }), async () => {
      await api.post(`/api/fleet/servers/${server.id}/settings/push`);
      showSnackbar(t('fleetPush.pushed', { defaultValue: 'Pushed' }), 'success');
    });

  const setPractice = (server: FleetServer, on: boolean) =>
    run(
      t('fleetPush.errors.practice', { defaultValue: 'Switching practice mode failed' }),
      async () => {
        const res = await api.put<FleetCommandAnswer>(`/api/fleet/servers/${server.id}/practice`, {
          on,
        });
        answered(
          res,
          on
            ? t('fleetPush.practiceOn', { defaultValue: 'Practice mode on' })
            : t('fleetPush.practiceOff', { defaultValue: 'Practice mode off' })
        );
      }
    );

  const saveWhitelist = (server: FleetServer) =>
    run(
      t('fleetPush.errors.whitelist', { defaultValue: 'Setting the whitelist failed' }),
      async () => {
        const ids = text
          .split(/[\s,;]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        const res = await api.put<FleetCommandAnswer>(`/api/fleet/servers/${server.id}/whitelist`, {
          enabled: whitelistEnabled,
          steamids: ids,
        });
        answered(res, t('fleetPush.whitelistSet', { defaultValue: 'Whitelist updated' }));
        setDialog(null);
      }
    );

  const savePlugins = (server: FleetServer) =>
    run(
      t('fleetPush.errors.plugins', { defaultValue: 'Changing the plugins failed' }),
      async () => {
        if (!pluginSet) return;
        const res = await api.post<FleetCommandAnswer>(`/api/fleet/servers/${server.id}/plugins`, {
          preset: pluginSet.preset,
          plugins: pluginSet.plugins,
        });
        answered(res, t('fleetPush.pluginsSet', { defaultValue: 'Plugins updated' }));
        setDialog(null);
      }
    );

  const saveDefaultPlugins = () =>
    run(
      t('pluginSets.errors.save', { defaultValue: 'Saving the default plugins failed' }),
      async () => {
        await api.put('/api/fleet/plugins/default', {
          plugins: pluginSet ? { preset: pluginSet.preset, plugins: pluginSet.plugins } : null,
        });
        await reloadCatalog();
        showSnackbar(t('pluginSets.saved', { defaultValue: 'Default plugins saved' }), 'success');
        setDialog(null);
      }
    );

  const saveExtras = () =>
    run(t('fleetPush.errors.admins', { defaultValue: 'Saving the admins failed' }), async () => {
      const parsed = parseAdminLines(text);
      if (parsed.bad.length > 0)
        throw new Error(
          t('fleetPush.badAdminLine', {
            line: parsed.bad[0],
            defaultValue: 'Not "SteamID64 name": {{line}}',
          })
        );
      const res = await api.put<{ rev: number; changed: boolean }>('/api/fleet/admins/extras', {
        admins: parsed.admins,
      });
      showSnackbar(
        res.changed
          ? t('fleetPush.adminsPushed', {
              rev: res.rev,
              defaultValue: 'Admin list rev {{rev}} pushed',
            })
          : t('fleetPush.adminsUnchanged', { defaultValue: 'The admin list did not change' }),
        'success'
      );
      setDialog(null);
    });

  const pushAdminsNow = () =>
    run(t('fleetPush.errors.push', { defaultValue: 'Push failed' }), async () => {
      const res = await api.post<{ pushed: number }>('/api/fleet/admins/push');
      showSnackbar(
        t('fleetPush.adminsPushedTo', {
          count: res.pushed,
          defaultValue: 'Sent to {{count}} server(s)',
        }),
        'success'
      );
    });

  const openWhitelist = (server: FleetServer) => {
    const wl = pushState[server.id]?.whitelist;
    setWhitelistEnabled(wl?.enabled ?? true);
    setText((wl?.steamids ?? []).join('\n'));
    setDialog({ kind: 'whitelist', server });
  };

  const openPlugins = (server: FleetServer) => {
    if (!catalog) return;
    const st = pushState[server.id];
    setPluginSet(initialPluginSet(catalog, st?.pluginSet, st?.pluginsState));
    setDialog({ kind: 'plugins', server });
  };

  const openDefaultPlugins = () => {
    setPluginSet(catalog?.default ?? null);
    setDialog({ kind: 'defaultPlugins' });
  };

  const openExtras = () => {
    setText((admins?.extras ?? []).map((a) => `${a.steamid64} ${a.name}`).join('\n'));
    setDialog({ kind: 'extras' });
  };

  if (servers.length === 0 && !admins) return null;

  const extrasSet = new Set((admins?.extras ?? []).map((a) => a.steamid64));

  return (
    <Box data-testid="fleet-push-panel" mt={4}>
      <SectionHead
        title={t('fleetPush.title', { defaultValue: 'Fleet settings' })}
        action={
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button
              size="small"
              variant="outlined"
              startIcon={<PuzzlePieceIcon />}
              onClick={openDefaultPlugins}
              disabled={!catalog}
              data-testid="fleet-default-plugins-edit"
            >
              {t('pluginSets.defaultButton', { defaultValue: 'Default plugins' })}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<GearIcon />}
              onClick={() => setDialog({ kind: 'defaults' })}
              data-testid="fleet-defaults-edit"
            >
              {t('fleetPush.editDefaults', { defaultValue: 'Fleet default settings' })}
            </Button>
          </Stack>
        }
      />

      {/* In-game admins (admins.set) */}
      <Box mb={3}>
        <Stack direction="row" alignItems="center" gap={1} mb={1} flexWrap="wrap">
          <UsersIcon size={18} />
          <Typography variant="subtitle2" fontWeight={600}>
            {t('fleetPush.adminsTitle', { defaultValue: 'In-game admins' })}
          </Typography>
          {admins && (
            <Chip
              size="small"
              label={t('fleetPush.adminsRev', {
                rev: admins.rev,
                count: admins.admins.length,
                defaultValue: 'rev {{rev}} · {{count}} admin(s)',
              })}
            />
          )}
          <Box flex={1} />
          <Button size="small" onClick={openExtras}>
            {t('fleetPush.editExtras', { defaultValue: 'Extra in-game admins' })}
          </Button>
          <Button
            size="small"
            startIcon={<ArrowsClockwiseIcon />}
            onClick={() => void pushAdminsNow()}
            disabled={busy || !admins || admins.rev < 1}
          >
            {t('fleetPush.pushAgain', { defaultValue: 'Push again' })}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {t('fleetPush.adminsHelp', {
            defaultValue:
              'Website admins with a Steam account, plus the extra in-game admins. Every Ready Up server gets this list when it changes and when it reconnects with an older one.',
          })}
        </Typography>
        <Box>
          {(admins?.admins ?? []).map((a) => (
            <Chip
              key={a.steamid64}
              size="small"
              variant={extrasSet.has(a.steamid64) ? 'outlined' : 'filled'}
              label={a.name}
              title={a.steamid64}
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
        </Box>
      </Box>

      {servers.length > 0 && (
        <RowList data-testid="fleet-push-servers">
          {servers.map((server) => {
            const st = pushState[server.id];
            const adminsCopy = admins?.servers.find((x) => x.serverId === server.id);
            return (
              <Row
                key={server.id}
                columns={{
                  xs: 'auto minmax(0, 1fr)',
                  md: 'auto minmax(0, 1fr) minmax(0, 1.6fr) auto',
                }}
                data-testid={`fleet-push-${server.id}`}
              >
                <StatusDot state={server.online ? 'live' : 'free'} />
                <Box minWidth={0}>
                  <Typography fontWeight={600} noWrap>
                    {server.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={mono}
                    display="block"
                    noWrap
                  >
                    {st?.override
                      ? t('fleetPush.hasOverride', { defaultValue: 'Own settings' })
                      : t('fleetPush.usesDefault', { defaultValue: 'Fleet default settings' })}
                    {adminsCopy?.rev !== null && adminsCopy?.rev !== undefined
                      ? ` · admins rev ${adminsCopy.rev}`
                      : ''}
                    {st?.pluginSet
                      ? ` · ${t(`pluginSets.preset.${st.pluginSet.preset}`, { defaultValue: st.pluginSet.preset })}`
                      : ''}
                  </Typography>
                </Box>
                <Box minWidth={0} gridColumn={{ xs: '1 / -1', md: 'auto' }}>
                  <StatusChip
                    status={st?.pushed.admins ?? null}
                    label={t('fleetPush.kind.admins', { defaultValue: 'admins' })}
                  />
                  <StatusChip
                    status={st?.pushed.serverConfig ?? null}
                    label={t('fleetPush.kind.serverConfig', { defaultValue: 'config' })}
                  />
                  <StatusChip
                    status={st?.pushed.settings ?? null}
                    label={t('fleetPush.kind.settings', { defaultValue: 'settings' })}
                  />
                  <StatusChip
                    status={st?.pushed.whitelist ?? null}
                    label={t('fleetPush.kind.whitelist', { defaultValue: 'whitelist' })}
                  />
                  <StatusChip
                    status={st?.pushed.practice ?? null}
                    label={t('fleetPush.kind.practice', { defaultValue: 'practice' })}
                  />
                  <StatusChip
                    status={st?.pushed.plugins ?? null}
                    label={t('fleetPush.kind.plugins', { defaultValue: 'plugins' })}
                  />
                </Box>
                <Stack
                  direction="row"
                  gap={0.5}
                  alignItems="center"
                  justifyContent="flex-end"
                  gridColumn={{ xs: '1 / -1', md: 'auto' }}
                  flexWrap="wrap"
                >
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={st?.practice === true}
                        disabled={busy}
                        onChange={(e) => void setPractice(server, e.target.checked)}
                        inputProps={{
                          'aria-label': t('fleetPush.practice', { defaultValue: 'Practice' }),
                        }}
                        data-testid={`fleet-practice-${server.id}`}
                      />
                    }
                    label={t('fleetPush.practice', { defaultValue: 'Practice' })}
                  />
                  <Button
                    size="small"
                    startIcon={<GearIcon />}
                    onClick={() => setDialog({ kind: 'override', server })}
                  >
                    {t('fleetPush.settings', { defaultValue: 'Settings' })}
                  </Button>
                  <Button
                    size="small"
                    startIcon={<ListChecksIcon />}
                    onClick={() => openWhitelist(server)}
                  >
                    {t('fleetPush.whitelist', { defaultValue: 'Whitelist' })}
                  </Button>
                  <Button
                    size="small"
                    startIcon={<PuzzlePieceIcon />}
                    onClick={() => openPlugins(server)}
                    disabled={!catalog}
                  >
                    {t('fleetPush.plugins', { defaultValue: 'Plugins' })}
                  </Button>
                  <Tooltip
                    title={t('fleetPush.pushSettingsNow', {
                      defaultValue: 'Send this server its settings again',
                    })}
                  >
                    <span>
                      <Button
                        size="small"
                        onClick={() => void pushSettingsNow(server)}
                        disabled={busy}
                        aria-label={t('fleetPush.pushSettingsNow', {
                          defaultValue: 'Send this server its settings again',
                        })}
                      >
                        <ArrowsClockwiseIcon size={18} />
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              </Row>
            );
          })}
        </RowList>
      )}

      <FleetSettingsDialog
        open={dialog?.kind === 'defaults'}
        title={t('fleetPush.editDefaults', { defaultValue: 'Fleet default settings' })}
        initial={defaults?.settings ?? null}
        saving={busy}
        onClose={() => setDialog(null)}
        onSave={(v) => void saveDefaults(v)}
      />
      <FleetSettingsDialog
        open={dialog?.kind === 'override'}
        title={
          dialog?.kind === 'override'
            ? t('fleetPush.serverSettingsTitle', {
                name: dialog.server.name,
                defaultValue: 'Settings: {{name}}',
              })
            : ''
        }
        inherited={defaults?.settings ?? null}
        initial={
          dialog?.kind === 'override' ? (pushState[dialog.server.id]?.override ?? null) : null
        }
        saving={busy}
        onClose={() => setDialog(null)}
        onSave={(v) => dialog?.kind === 'override' && void saveOverride(dialog.server, v)}
        onClear={() => dialog?.kind === 'override' && void saveOverride(dialog.server, null)}
      />

      {/* Whitelist */}
      <Dialog
        open={dialog?.kind === 'whitelist'}
        onClose={() => setDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {dialog?.kind === 'whitelist'
            ? t('fleetPush.whitelistTitle', {
                name: dialog.server.name,
                defaultValue: 'Whitelist: {{name}}',
              })
            : ''}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPush.whitelistHelp', {
              defaultValue:
                'Replaces the whitelist plugin\'s list and switch on this server (whitelist.set). One SteamID64 per line; at most 1000. Servers without the whitelist plugin answer "unsupported".',
            })}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={whitelistEnabled}
                onChange={(e) => setWhitelistEnabled(e.target.checked)}
              />
            }
            label={t('fleetPush.whitelistEnabled', { defaultValue: 'Whitelist on' })}
          />
          <TextField
            fullWidth
            multiline
            minRows={6}
            size="small"
            sx={{ mt: 1, ...mono }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="76561198000000000"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => dialog?.kind === 'whitelist' && void saveWhitelist(dialog.server)}
          >
            {t('fleetPush.send', { defaultValue: 'Send' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Plugins */}
      <Dialog
        open={dialog?.kind === 'plugins'}
        onClose={() => setDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {dialog?.kind === 'plugins'
            ? t('fleetPush.pluginsTitle', {
                name: dialog.server.name,
                defaultValue: 'Plugins: {{name}}',
              })
            : ''}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('pluginSets.serverHelp', {
              defaultValue:
                'Turns Ready Up plugins on or off on this server (plugins.set). The server keeps the choice after a restart, and gets it again if it reconnects with other plugins on.',
            })}
          </Typography>
          {catalog && pluginSet && (
            <PluginSetPicker
              catalog={catalog}
              value={pluginSet}
              onChange={setPluginSet}
              installed={
                dialog?.kind === 'plugins'
                  ? (pushState[dialog.server.id]?.pluginsState?.installed ?? null)
                  : null
              }
              disabled={busy}
              testId="server-plugins"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => dialog?.kind === 'plugins' && void savePlugins(dialog.server)}
          >
            {t('fleetPush.send', { defaultValue: 'Send' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Default plugins for new servers */}
      <Dialog
        open={dialog?.kind === 'defaultPlugins'}
        onClose={() => setDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('pluginSets.defaultTitle', { defaultValue: 'Default plugins for new servers' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('pluginSets.defaultHelp', {
              defaultValue:
                'Servers created on a machine, by automatic scaling or for a failover get these plugins when they first connect, unless they were created with their own choice. Servers that already exist keep theirs.',
            })}
          </Typography>
          {catalog && (
            <PluginSetPicker
              catalog={{ ...catalog, default: null }}
              value={pluginSet}
              onChange={setPluginSet}
              nullLabel={t('pluginSets.preset.none', { defaultValue: 'None' })}
              disabled={busy}
              testId="default-plugins"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !catalog}
            onClick={() => void saveDefaultPlugins()}
            data-testid="default-plugins-save"
          >
            {t('pluginSets.save', { defaultValue: 'Save' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Extra in-game admins */}
      <Dialog
        open={dialog?.kind === 'extras'}
        onClose={() => setDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('fleetPush.editExtras', { defaultValue: 'Extra in-game admins' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPush.extrasHelp', {
              defaultValue:
                'In-game admins who are not website admins (referees, casters). One per line: SteamID64, then a name.',
            })}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={6}
            size="small"
            sx={mono}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="76561198000000000 Referee"
            inputProps={{ 'data-testid': 'fleet-extra-admins' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveExtras()}>
            {t('fleetPush.saveAndPush', { defaultValue: 'Save and push' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
