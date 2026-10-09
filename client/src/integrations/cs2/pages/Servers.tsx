/**
 * Servers: the csm machines and the servers on them (Vikunja 1873, the draft
 * website/drafts/platform/servers.html).
 *
 * Servers come only through csm now: a machine is linked with one command,
 * and every server on it is created, started, stopped, restarted, updated and
 * deleted from here. The platform talks to csm, never to a server by RCON.
 * State is colour and a word on each tile; details and actions open in a side
 * panel. Whatever is asked of csm shows at once and follows csm's progress
 * over the socket. Fleet settings (scaling, the fleet link, what is pushed to
 * servers, failover) sit behind one button.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Menu, MenuItem, Typography } from '@mui/material';
import { GearSixIcon, PlusIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  PageHead,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { FleetHost } from '../cs2.types';
import AutoScalePanel from '../servers/AutoScalePanel';
import FleetPanel from '../servers/FleetPanel';
import FleetPushPanel from '../servers/FleetPushPanel';
import FailoverSettingsPanel from '../servers/FailoverSettingsPanel';
import { OPEN_EVENT } from '../servers/openServerSection';
import { countServers } from '../servers/machineState';
import { insecureFlag } from '../servers/insecureLink';
import { serverLimitText, useServerLimit } from '../servers/serverLimit';
import { useFleet } from '../servers/fleet/useFleet';
import { useServerMatches } from '../servers/fleet/useServerMatches';
import { MachineCard } from '../servers/fleet/MachineCard';
import { ServerSheet } from '../servers/fleet/ServerSheet';
import { MachineSheet } from '../servers/fleet/MachineSheet';
import { SideSheet } from '../servers/fleet/SideSheet';
import { FirstMachine } from '../servers/fleet/FirstMachine';
import { OtherServers } from '../servers/fleet/OtherServers';
import {
  AddMachineDialog,
  AddServersDialog,
  ForceDialog,
  LinkDialog,
  ReadyUpDialog,
  type LinkInfo,
} from '../servers/fleet/FleetDialogs';

const { color } = tokens;

const SETTINGS_SECTIONS = ['autoscale', 'fleet', 'fleet-settings', 'failover'];

/** Online machines first; then the ones waiting to be linked, the offline ones, the revoked. */
function hostRank(host: FleetHost): number {
  if (host.status === 'enrolled') return host.online ? 0 : 2;
  return host.status === 'pending' ? 1 : 3;
}

export default function Servers() {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const fleet = useFleet();
  const { hosts, loaded } = fleet;
  const matches = useServerMatches();
  const limit = useServerLimit();
  const [params, setParams] = useSearchParams();

  // A machine's panel is `?machine=<id>` (links from elsewhere open it); a server's is local.
  const machineId = params.get('machine');
  const openMachine = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('machine', id);
      else next.delete('machine');
      return next;
    });
  const [serverOpen, setServerOpen] = useState<{ hostId: string; name: string } | null>(null);

  // Fleet settings: the button, `#autoscale` and friends, or openServerSection().
  const [settingsOpen, setSettingsOpen] = useState(() => SETTINGS_SECTIONS.includes(window.location.hash.slice(1)));
  useEffect(() => {
    const onOpen = (e: Event) => {
      if (SETTINGS_SECTIONS.includes((e as CustomEvent<string>).detail)) setSettingsOpen(true);
    };
    const onHash = () => {
      if (SETTINGS_SECTIONS.includes(window.location.hash.slice(1))) setSettingsOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const [menu, setMenu] = useState<{ host: FleetHost; anchor: HTMLElement } | null>(null);
  const [addServersFor, setAddServersFor] = useState<FleetHost | null>(null);
  const [readyUpFor, setReadyUpFor] = useState<FleetHost | null>(null);
  const [deleteServer, setDeleteServer] = useState<{ host: FleetHost; server: string } | null>(null);
  const [pending, setPending] = useState<{ action: 'revoke' | 'remove'; host: FleetHost } | null>(null);
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [linkInline, setLinkInline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [licenseMax, setLicenseMax] = useState<number | null>(null);
  useEffect(() => {
    api
      .get<{ license?: { maxServers?: number; kind?: string } | null }>('/api/license')
      // A free key has no server limit.
      .then((res) => setLicenseMax(res?.license?.kind !== 'free' && typeof res?.license?.maxServers === 'number' ? res.license.maxServers : null))
      .catch(() => setLicenseMax(null));
  }, []);

  const linkCommand = (code: string) => `csm link ${window.location.origin} ${code}${insecureFlag()}`;

  const addMachine = useCallback(
    async (name: string, inline: boolean) => {
      setBusy(true);
      try {
        const res = await api.post<{ host: FleetHost; code: string; expiresAt: number }>('/api/fleet/hosts', name ? { name } : {});
        setAddMachineOpen(false);
        setLinkInline(inline);
        setLink({ hostId: res.host.id, name: res.host.name, command: linkCommand(res.code), expiresAt: res.expiresAt });
        await fleet.load();
      } catch (err) {
        showError(apiErrorMessage(err, t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })));
      } finally {
        setBusy(false);
      }
    },
    [fleet, showError, t]
  );

  const newCode = async (host: FleetHost) => {
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(`/api/fleet/hosts/${host.id}/code`);
      setLinkInline(false);
      setLink({ hostId: host.id, name: host.name, command: linkCommand(res.code), expiresAt: res.expiresAt });
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })));
    }
  };

  const rotate = async (host: FleetHost) => {
    try {
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(`/api/fleet/hosts/${host.id}/rotate`);
      showSnackbar(
        res.rotation === 'sent'
          ? t('machinesPanel.rotateSent', { defaultValue: 'New token sent' })
          : t('machinesPanel.rotateQueued', { defaultValue: 'The machine gets a new token when it next connects' }),
        'success'
      );
      await fleet.load();
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.command', { defaultValue: 'The command failed' })));
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'revoke') await api.post(`/api/fleet/hosts/${pending.host.id}/revoke`);
      else await api.delete(`/api/fleet/hosts/${pending.host.id}`);
      if (machineId === pending.host.id) openMachine(null);
      await fleet.load();
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.command', { defaultValue: 'The command failed' })));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  // The first machine's guide stays up from "Get the command" until csm
  // connects: the code adds the (not yet linked) machine to the list.
  const firstSetup =
    loaded &&
    (hosts.length === 0 ||
      (linkInline && link !== null && hosts.length === 1 && hosts[0].id === link.hostId && !hosts[0].online));
  const linked = link ? hosts.find((h) => h.id === link.hostId) : undefined;
  const linkConnected = !!linked && linked.status === 'enrolled' && linked.online;

  const counts = countServers(hosts, fleet.isDeleting);
  const total = hosts.reduce((n, h) => n + h.servers.length, 0);
  const sheetHost = serverOpen ? hosts.find((h) => h.id === serverOpen.hostId) ?? null : null;
  const sheetServer = sheetHost?.servers.find((s) => s.name === serverOpen?.name) ?? null;
  const machineHost = machineId ? hosts.find((h) => h.id === machineId) ?? null : null;

  const pill = (key: string, n: number, tone: string, label: string) => (
    <Box
      key={key}
      data-testid={`machines-count-${key}`}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.9,
        px: 1.5,
        py: 0.75,
        borderRadius: radii.pill,
        border: `1px solid ${color.rule}`,
        fontSize: textSize.sm,
        color: color.ink2,
      }}
    >
      <Box aria-hidden sx={{ width: 9, height: 9, borderRadius: radii.pill, bgcolor: tone }} />
      <Box component="b" sx={{ color: color.ink, fontVariantNumeric: 'tabular-nums' }}>
        {n}
      </Box>
      {label}
    </Box>
  );

  return (
    <Box data-testid="servers-page" sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <PageHead
        title={t('serversPage.title')}
        subtitle={
          <span data-testid="servers-limit">
            {t('serversPage.machineCount', { count: hosts.length })}
            {' · '}
            {t('serversPage.fleet.total', { count: total })}
            {limit &&
              (() => {
                const line = serverLimitText(limit, total);
                return ` · ${t(line.key, line.values)}`;
              })()}
          </span>
        }
        actions={
          <>
            <Button variant="outlined" startIcon={<GearSixIcon />} onClick={() => setSettingsOpen(true)} data-testid="servers-settings-toggle">
              {t('serversBoard.fleetSettings', { defaultValue: 'Fleet settings' })}
            </Button>
            <Button variant="contained" startIcon={<PlusIcon />} onClick={() => setAddMachineOpen(true)} data-testid="machines-add">
              {t('machinesPanel.add', { defaultValue: 'Add machine' })}
            </Button>
          </>
        }
      />

      {firstSetup ? (
        <FirstMachine link={linkInline ? link : null} busy={busy} onCreate={(name) => void addMachine(name, true)} />
      ) : (
        <Box data-testid="machines-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {hosts.length > 0 && (
            <Box data-testid="machines-summary" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} aria-label={t('serversBoard.summary', { defaultValue: 'All servers' })}>
              {pill('free', counts.free, color.live, t('machinesPanel.counts.free', { defaultValue: 'Free' }).toLowerCase())}
              {pill('match', counts.match, color.accent, t('machinesPanel.counts.match', { defaultValue: 'In a match' }).toLowerCase())}
              {pill('busy', counts.busy, color.info, t('machinesPanel.counts.busy', { defaultValue: 'Updating or restarting' }).toLowerCase())}
              {pill('down', counts.down, color.muted, t('machinesPanel.counts.down', { defaultValue: 'Stopped or offline' }).toLowerCase())}
            </Box>
          )}
          {[...hosts]
            .sort((a, b) => hostRank(a) - hostRank(b))
            .map((host) => (
              <MachineCard
                key={host.id}
                host={host}
                matchByServer={matches}
                isDeleting={fleet.isDeleting}
                onOpenMachine={() => openMachine(host.id)}
                onOpenServer={(name) => setServerOpen({ hostId: host.id, name })}
                onMenu={(anchor) => setMenu({ host, anchor })}
                onAddServers={() => setAddServersFor(host)}
                onUpdateGame={() => void fleet.send(host, 'host.update_game', {})}
                onUpdateReadyUp={() => setReadyUpFor(host)}
                onNewCode={() => void newCode(host)}
                onRetry={(c) => void fleet.send(host, c.type, c.payload)}
              />
            ))}
          {licenseMax !== null && hosts.length > 0 && (
            <Typography variant="caption" color="text.secondary" data-testid="machines-license-note">
              {t('machinesPanel.licenseNote', {
                defaultValue: 'Your license covers up to {{count}} servers. Every server counts, spares included.',
                count: licenseMax,
              })}
            </Typography>
          )}
        </Box>
      )}

      <OtherServers hosts={hosts} />

      <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const h = menu?.host;
            setMenu(null);
            if (h) openMachine(h.id);
          }}
        >
          {t('serversBoard.details', { defaultValue: 'Details and activity' })}
        </MenuItem>
        {menu?.host.status === 'pending' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              void newCode(h);
            }}
          >
            {t('machinesPanel.newCode', { defaultValue: 'New code' })}
          </MenuItem>
        )}
        {menu?.host.status === 'enrolled' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              void rotate(h);
            }}
          >
            {t('machinesPanel.rotate', { defaultValue: 'Rotate token' })}
          </MenuItem>
        )}
        {menu?.host.status === 'enrolled' && (
          <MenuItem
            sx={{ color: 'error.main' }}
            data-testid={`machine-revoke-${menu.host.id}`}
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              setPending({ action: 'revoke', host: h });
            }}
          >
            {t('machinesPanel.revoke', { defaultValue: 'Revoke machine' })}
          </MenuItem>
        )}
        {menu && menu.host.status !== 'enrolled' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              setPending({ action: 'remove', host: h });
            }}
          >
            {t('machinesPanel.remove', { defaultValue: 'Remove' })}
          </MenuItem>
        )}
      </Menu>

      <ServerSheet
        fleet={fleet}
        host={sheetServer ? sheetHost : null}
        serverName={sheetServer ? serverOpen?.name ?? null : null}
        match={sheetServer?.fleetServer ? matches[sheetServer.fleetServer.id] ?? null : null}
        onClose={() => setServerOpen(null)}
        onDelete={(host, server) => setDeleteServer({ host, server })}
      />
      <MachineSheet
        fleet={fleet}
        host={machineHost}
        onClose={() => openMachine(null)}
        onAddServers={(h) => setAddServersFor(h)}
        onUpdateReadyUp={(h) => setReadyUpFor(h)}
      />
      <SideSheet
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          if (SETTINGS_SECTIONS.includes(window.location.hash.slice(1))) window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }}
        wide
        testId="servers-settings"
        title={t('serversBoard.fleetSettings', { defaultValue: 'Fleet settings' })}
        subtitle={t('serversBoard.fleetSettingsAbout', {
          defaultValue: 'Starting and stopping servers on their own, the fleet link, what goes out to every server, and failover.',
        })}
      >
        <AutoScalePanel />
        <FleetPanel />
        <FleetPushPanel />
        <FailoverSettingsPanel />
      </SideSheet>

      <AddServersDialog fleet={fleet} host={addServersFor} onClose={() => setAddServersFor(null)} />
      <ReadyUpDialog fleet={fleet} host={readyUpFor} onClose={() => setReadyUpFor(null)} />
      <ForceDialog fleet={fleet} />
      <AddMachineDialog open={addMachineOpen} busy={busy} onClose={() => setAddMachineOpen(false)} onCreate={(name) => void addMachine(name, false)} />
      <LinkDialog link={link && !(linkInline && firstSetup) ? link : null} connected={linkConnected} onClose={() => setLink(null)} />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'remove'
            ? t('machinesPanel.confirm.removeTitle', { defaultValue: 'Remove this machine?' })
            : t('machinesPanel.confirm.revokeTitle', { defaultValue: 'Revoke this machine?' })
        }
        message={
          pending?.action === 'remove'
            ? t('machinesPanel.confirm.removeMessage', {
                defaultValue: '{{name}} is forgotten. csm can link it again with a new code.',
                name: pending.host.name,
              })
            : t('machinesPanel.confirm.revokeMessage', {
                defaultValue: '{{name}} is disconnected and its token stops working. Its servers keep running and stay on the fleet link.',
                name: pending?.host.name ?? '',
              })
        }
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={deleteServer !== null}
        title={t('machinesPanel.confirm.deleteServerTitle', { defaultValue: 'Delete {{name}}?', name: deleteServer?.server ?? '' })}
        message={t('machinesPanel.confirm.deleteServerMessage', {
          defaultValue:
            '{{name}} is stopped and its folder on {{host}} is deleted. Its Ready Up entry is removed from the fleet. Refused while it plays a match.',
          name: deleteServer?.server ?? '',
          host: deleteServer?.host.name ?? '',
        })}
        confirmColor="error"
        onConfirm={() => {
          const target = deleteServer;
          setDeleteServer(null);
          setServerOpen(null);
          if (target) void fleet.removeServer(target.host, target.server);
        }}
        onCancel={() => setDeleteServer(null)}
      />
    </Box>
  );
}
