import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { CopyIcon } from '@phosphor-icons/react';
import { mono, radii, StatusDot, tokens, useModuleTranslation, useSnackbar } from '../../../../module-sdk';
import type { FleetHost } from '../../cs2.types';
import type { PluginSetValue } from '../fleetPush.types';
import PluginSetPicker, { usePluginCatalog } from '../PluginSetPicker';
import { platformIsPlainHttp } from '../insecureLink';
import type { Fleet, ForcePrompt } from './useFleet';

const { color } = tokens;

export function useCopy() {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  return async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSnackbar(t('machinesPanel.copied', { defaultValue: 'Copied' }), 'success');
    } catch {
      showError(t('machinesPanel.copyFailed', { defaultValue: 'Could not copy' }));
    }
  };
}

/** A command to copy, in a box with a copy button. */
export function CommandBox({ command, testId }: { command: string; testId: string }) {
  const { t } = useModuleTranslation('cs2');
  const copy = useCopy();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, borderRadius: radii.md, bgcolor: color.paper3, ...mono, fontSize: '0.8125rem', wordBreak: 'break-all' }}>
      <Box flex={1} data-testid={testId}>
        {command}
      </Box>
      <IconButton size="small" onClick={() => void copy(command)} aria-label={t('machinesPanel.copy', { defaultValue: 'Copy' })}>
        <CopyIcon size={18} />
      </IconButton>
    </Box>
  );
}

/** Add servers to a machine: how many (always), and their Ready Up plugins. They show as "Creating…" at once. */
export function AddServersDialog({ fleet, host, onClose }: { fleet: Fleet; host: FleetHost | null; onClose: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const [count, setCount] = useState('2');
  const [plugins, setPlugins] = useState<PluginSetValue | null>(null);
  const { catalog } = usePluginCatalog(host !== null);
  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= 16;
  return (
    <Dialog open={host !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('machinesPanel.addServers', { defaultValue: 'Add servers' })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('serversBoard.addHelp', {
            defaultValue: 'On {{name}}. New servers get Ready Up and connect to this platform on their own; they show up below as they are made.',
            name: host?.name ?? '',
          })}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          type="number"
          label={t('machinesPanel.count', { defaultValue: 'How many' })}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          inputProps={{ min: 1, max: 16, 'data-testid': 'add-servers-count' }}
          sx={{ mb: 2 }}
        />
        <Typography variant="subtitle2" mb={1}>
          {t('pluginSets.createLabel', { defaultValue: 'Ready Up plugins' })}
        </Typography>
        {catalog ? (
          <PluginSetPicker
            catalog={catalog}
            value={plugins}
            onChange={setPlugins}
            nullLabel={t('pluginSets.preset.default', { defaultValue: 'Fleet default' })}
            showBundleNote
            testId="create-plugins"
          />
        ) : (
          <LinearProgress />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!valid}
          data-testid="add-servers-confirm"
          onClick={() => {
            if (!host) return;
            onClose();
            void fleet.send(host, 'server.create', { count: n, enroll: true }, {
              extra: plugins ? { plugins: { preset: plugins.preset, plugins: plugins.plugins } } : {},
            });
          }}
        >
          {valid
            ? t('serversBoard.createN', { defaultValue: 'Create {{count}} servers', count: n })
            : t('machinesPanel.create', { defaultValue: 'Create' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Update Ready Up on a machine: which release and bundle. */
export function ReadyUpDialog({ fleet, host, onClose }: { fleet: Fleet; host: FleetHost | null; onClose: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const [version, setVersion] = useState('latest');
  const [bundle, setBundle] = useState<'default' | 'skins'>('default');
  return (
    <Dialog open={host !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('machinesPanel.updateReadyUp', { defaultValue: 'Update Ready Up…' })}</DialogTitle>
      <DialogContent>
        <Stack gap={2} mt={1}>
          <TextField
            size="small"
            label={t('machinesPanel.version', { defaultValue: 'Version' })}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            helperText={t('machinesPanel.versionHelp', { defaultValue: '"latest" or a release, e.g. 0.5.0' })}
          />
          <TextField select size="small" label={t('machinesPanel.bundle', { defaultValue: 'Bundle' })} value={bundle} onChange={(e) => setBundle(e.target.value as 'default' | 'skins')}>
            <MenuItem value="default">{t('machinesPanel.bundleDefault', { defaultValue: 'Default' })}</MenuItem>
            <MenuItem value="skins">{t('machinesPanel.bundleSkins', { defaultValue: 'With skins' })}</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!version.trim()}
          onClick={() => {
            if (!host) return;
            onClose();
            void fleet.send(host, 'host.update_plugins', { readyup: { version: version.trim(), bundle } });
          }}
        >
          {t('machinesPanel.update', { defaultValue: 'Update' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The servers an update would touch that have no match in progress. */
function idleTargets(prompt: ForcePrompt): string[] {
  const asked = Array.isArray(prompt.payload.servers) ? (prompt.payload.servers as string[]) : null;
  return prompt.host.servers.map((s) => s.name).filter((name) => (asked ? asked.includes(name) : true) && !prompt.servers.includes(name));
}

/** A disruptive action refused because a match is on: say why to go ahead, or update only the idle servers. */
export function ForceDialog({ fleet }: { fleet: Fleet }) {
  const { t } = useModuleTranslation('cs2');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const force = fleet.force;
  const close = () => {
    fleet.setForce(null);
    setReason('');
  };
  const isUpdate = force && (force.type === 'host.update_game' || force.type === 'host.update_plugins');
  const idle = force ? idleTargets(force) : [];
  return (
    <Dialog open={force !== null} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{t('machinesPanel.forceTitle', { defaultValue: 'A match is in progress' })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" mb={2}>
          {t('machinesPanel.forceHelp', {
            defaultValue: 'This interrupts the match on {{servers}}. Say why; it is recorded.',
            servers: force?.servers.join(', ') ?? '',
          })}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={t('machinesPanel.forceReason', { defaultValue: 'Reason' })}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          inputProps={{ maxLength: 500, 'data-testid': 'machines-force-reason' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('common.cancel')}</Button>
        {isUpdate && idle.length > 0 && (
          <Button
            disabled={busy}
            data-testid="machines-update-idle"
            onClick={() => {
              if (!force) return;
              close();
              void fleet.send(force.host, force.type, { ...force.payload, servers: idle }, { extra: force.extra });
            }}
          >
            {t('machinesPanel.updateIdleOnly', { defaultValue: 'Only the idle servers ({{count}})', count: idle.length })}
          </Button>
        )}
        <Button
          variant="contained"
          color="error"
          disabled={busy || !reason.trim()}
          data-testid="machines-force-confirm"
          onClick={async () => {
            if (!force) return;
            setBusy(true);
            const ok = await fleet.send(force.host, force.type, force.payload, { forceReason: reason.trim(), extra: force.extra });
            setBusy(false);
            if (ok) close();
          }}
        >
          {t('machinesPanel.forceConfirm', { defaultValue: 'Interrupt the match' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export type LinkInfo = { hostId: string; name: string; command: string; expiresAt: number };

/** The one command that links a machine; turns green when csm connects. */
export function LinkDialog({ link, connected, onClose }: { link: LinkInfo | null; connected: boolean; onClose: () => void }) {
  const { t, i18n } = useModuleTranslation('cs2');
  return (
    <Dialog open={link !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('machinesPanel.linkTitle', { defaultValue: 'Run this on {{name}}', name: link?.name ?? '' })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" mb={2}>
          {t('machinesPanel.linkHelp', {
            defaultValue: 'Run it on the machine as the user that runs csm (not root). The code works once and until {{time}}.',
            time: link ? new Date(link.expiresAt * 1000).toLocaleString(i18n.language) : '',
          })}
        </Typography>
        {link && <CommandBox command={link.command} testId="machines-link-command" />}
        {platformIsPlainHttp() && (
          <Typography variant="caption" color="warning.main" display="block" mt={1.5} data-testid="machines-insecure-note">
            {t('machinesPanel.insecureNote', {
              defaultValue: 'This site is on plain http://, so the command has --insecure and the token travels unencrypted. Serve the platform over https:// if you can.',
            })}
          </Typography>
        )}
        <Stack direction="row" gap={1} alignItems="center" mt={2} data-testid="machines-link-status">
          <StatusDot state={connected ? 'live' : 'loading'} />
          <Typography variant="body2" color={connected ? 'success.main' : 'text.secondary'}>
            {connected
              ? t('machinesPanel.linkConnected', { defaultValue: 'Connected. The machine is ready.' })
              : t('machinesPanel.linkWaiting', { defaultValue: 'Waiting for the machine to connect…' })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {connected ? t('machinesPanel.done', { defaultValue: 'Done' }) : t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Name a new machine; the next step is its command. */
export function AddMachineDialog({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const [name, setName] = useState('');
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('machinesPanel.add', { defaultValue: 'Add machine' })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('machinesPanel.addHelp', { defaultValue: 'You get one command to run on the machine. It needs CS2 Server Manager (csm) installed.' })}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={t('machinesPanel.name', { defaultValue: 'Name (optional)' })}
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 100 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={busy}
          data-testid="machines-create-code"
          onClick={() => {
            onCreate(name.trim());
            setName('');
          }}
        >
          {t('machinesPanel.getCommand', { defaultValue: 'Get the command' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
