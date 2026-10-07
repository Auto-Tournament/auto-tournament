import { Box, Button, Chip, LinearProgress, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { CheckIcon, DownloadSimpleIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { fontDisplay, mono, radii, tokens, useModuleTranslation, withAlpha } from '../../../../module-sdk';
import type { FleetHost, FleetHostCommand } from '../../cs2.types';
import { readyUpVersion, useCommandLabel, useProblemText } from './MachineCard';
import { Facts, SideSheet } from './SideSheet';
import type { Fleet } from './useFleet';

const { color } = tokens;

const gb = (mb: number) => (mb / 1024).toFixed(1);

function Bar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" mb={0.75}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={mono}>
          {value}
        </Typography>
      </Stack>
      <Box sx={{ height: 6, borderRadius: radii.pill, bgcolor: color.paper3, overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', bgcolor: pct >= 90 ? color.ban : pct >= 75 ? color.warning : color.live }} />
      </Box>
    </Box>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>{children}</Typography>;
}

/**
 * A machine on its own: what it has left (CPU, RAM, disk), its CS2 build and
 * Ready Up, how it updates, and what it was asked to do lately with how that
 * went. The machine's actions are here too.
 */
export function MachineSheet({
  fleet,
  host,
  onClose,
  onAddServers,
  onUpdateReadyUp,
}: {
  fleet: Fleet;
  host: FleetHost | null;
  onClose: () => void;
  onAddServers: (host: FleetHost) => void;
  onUpdateReadyUp: (host: FleetHost) => void;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const commandLabel = useCommandLabel();
  const problemText = useProblemText();
  const when = (s: number | null | undefined) => (s ? new Date(s * 1000).toLocaleString(i18n.language) : '—');
  const inv = host?.inventory ?? null;
  const online = !!host && host.status === 'enrolled' && host.online;
  const disk = inv?.resources.disk[0];
  const ru = host ? readyUpVersion(host) : null;

  const commandRow = (c: FleetHostCommand) => {
    const tone = c.status === 'ok' ? color.live : c.status === 'pending' ? color.info : color.ban;
    return (
      <Box key={c.id} data-testid={`machine-command-${c.id}`} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.75 }}>
        <Box aria-hidden sx={{ width: 22, height: 22, borderRadius: radii.pill, bgcolor: withAlpha(tone, 0.18), color: tone, display: 'grid', placeItems: 'center', flex: 'none', mt: 0.25 }}>
          {c.status === 'ok' ? <CheckIcon size={12} weight="bold" /> : c.status === 'pending' ? <Box sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: tone }} /> : <XIcon size={12} weight="bold" />}
        </Box>
        <Box minWidth={0} flex={1}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2">{commandLabel(c)}</Typography>
            {c.forcedBy && (
              <Tooltip title={c.forceReason ?? ''}>
                <Chip size="small" color="warning" label={t('machinesPanel.forced', { defaultValue: 'Forced' })} />
              </Tooltip>
            )}
          </Stack>
          {c.status === 'pending' ? (
            <>
              {c.progress.pct !== null && (
                <LinearProgress variant="determinate" value={c.progress.pct} aria-label={t('machinesPanel.progress', { defaultValue: 'Command progress' })} sx={{ my: 0.5, maxWidth: 260 }} />
              )}
              <Typography variant="caption" color="text.secondary" display="block">
                {c.progress.step ??
                  (c.seq === null ? t('machinesPanel.queuedShort', { defaultValue: 'Queued' }) : t('machinesPanel.working', { defaultValue: 'csm is on it' }))}
              </Typography>
            </>
          ) : c.status === 'ok' ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('machinesPanel.status.ok', { defaultValue: 'Done' })} · {when(c.answeredAt ?? c.createdAt)}
            </Typography>
          ) : (
            <Typography variant="caption" color="error.main" display="block">
              {problemText(c)}
            </Typography>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <SideSheet
      open={!!host}
      onClose={onClose}
      testId="machine-sheet"
      title={host?.name ?? ''}
      subtitle={host ? [host.hostname, host.os, host.csmVersion ? `csm ${host.csmVersion}` : null].filter(Boolean).join(' · ') : undefined}
    >
      {host && (
        <>
          {host.status === 'enrolled' && (
            <Stack direction="row" gap={1} flexWrap="wrap">
              <Button variant="contained" size="small" startIcon={<PlusIcon />} disabled={!online} onClick={() => onAddServers(host)} data-testid={`machine-create-several-${host.id}`}>
                {t('machinesPanel.addServers', { defaultValue: 'Add servers' })}
              </Button>
              <Button variant="outlined" size="small" startIcon={<DownloadSimpleIcon />} disabled={!online} onClick={() => void fleet.send(host, 'host.update_game', {})} data-testid={`machine-update-game-${host.id}`}>
                {t('machinesPanel.updateGame', { defaultValue: 'Update CS2' })}
              </Button>
              <Button variant="outlined" size="small" startIcon={<DownloadSimpleIcon />} disabled={!online} onClick={() => onUpdateReadyUp(host)}>
                {t('machinesPanel.updateReadyUp', { defaultValue: 'Update Ready Up…' })}
              </Button>
            </Stack>
          )}

          {inv && (
            <Stack gap={1.75}>
              <SectionTitle>{t('machinesPanel.machine', { defaultValue: 'Machine' })}</SectionTitle>
              <Bar label={t('machinesPanel.cpu', { defaultValue: 'CPU load' })} value={`${inv.resources.load1.toFixed(2)} / ${inv.resources.cpus}`} pct={(inv.resources.load1 / Math.max(1, inv.resources.cpus)) * 100} />
              <Bar
                label={t('machinesPanel.ram', { defaultValue: 'RAM' })}
                value={`${gb(inv.resources.ram_mb - inv.resources.ram_free_mb)} / ${gb(inv.resources.ram_mb)} GB`}
                pct={((inv.resources.ram_mb - inv.resources.ram_free_mb) / Math.max(1, inv.resources.ram_mb)) * 100}
              />
              {disk && (
                <Bar
                  label={t('machinesPanel.diskLabel', { defaultValue: 'Disk {{mount}}', mount: disk.mount })}
                  value={`${(disk.total_gb - disk.free_gb).toFixed(0)} / ${disk.total_gb.toFixed(0)} GB`}
                  pct={((disk.total_gb - disk.free_gb) / Math.max(1, disk.total_gb)) * 100}
                />
              )}
            </Stack>
          )}

          {inv && (
            <Stack gap={1.5}>
              <SectionTitle>{t('serversBoard.versions', { defaultValue: 'Versions and updates' })}</SectionTitle>
              <Facts
                items={[
                  [
                    'CS2',
                    `${inv.cs2.master_build}${inv.cs2.update_available ? ` · ${t('machinesPanel.cs2UpdateAvailable', { defaultValue: 'CS2 update available' })}` : ''}`,
                  ],
                  ['Ready Up', ru ?? t('machinesPanel.noReadyUp', { defaultValue: 'No Ready Up' })],
                  host.autoUpdate && [t('serversBoard.autoUpdates', { defaultValue: 'Automatic updates' }), `CS2 · ${host.autoUpdate.game} / Ready Up · ${host.autoUpdate.readyUp}`],
                ]}
              />
              {host.status === 'enrolled' && (
                <TextField
                  select
                  size="small"
                  label={t('machinesPanel.updatesHold', { defaultValue: 'Automatic updates' })}
                  value={inv.cs2.updates_hold ?? 'auto'}
                  disabled={!online}
                  onChange={(e) => void fleet.send(host, 'host.updates_hold', { mode: e.target.value })}
                >
                  <MenuItem value="auto">{t('machinesPanel.hold.auto', { defaultValue: 'Automatic (wait for idle)' })}</MenuItem>
                  <MenuItem value="on">{t('machinesPanel.hold.on', { defaultValue: 'Held' })}</MenuItem>
                  <MenuItem value="off">{t('machinesPanel.hold.off', { defaultValue: 'Not held' })}</MenuItem>
                </TextField>
              )}
            </Stack>
          )}

          {host.commands.length > 0 && (
            <Box>
              <SectionTitle>{t('machinesPanel.activity', { defaultValue: 'Activity' })}</SectionTitle>
              <Box mt={1}>{host.commands.slice(0, 10).map(commandRow)}</Box>
            </Box>
          )}

          {host.health.length > 0 && (
            <Box>
              <SectionTitle>{t('serversBoard.health', { defaultValue: 'Server health' })}</SectionTitle>
              <Box mt={1}>
                {host.health.slice(0, 6).map((h) => (
                  <Typography key={h.id} variant="caption" display="block" color={h.event === 'recovered' || h.event === 'restarted' ? 'text.secondary' : 'warning.main'}>
                    {when(h.receivedAt)} · {h.server}: {t(`machinesPanel.healthEvent.${h.event}`, { defaultValue: h.event })}
                    {h.detail ? ` (${h.detail})` : ''}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          {host.enrolledServers.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {t('machinesPanel.enrolledElsewhere', { defaultValue: 'Enrolled from this machine: {{names}}', names: host.enrolledServers.map((s) => s.name).join(', ') })}
            </Typography>
          )}
        </>
      )}
    </SideSheet>
  );
}
