import { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, IconButton, LinearProgress } from '@mui/material';
import { CheckIcon, DotsThreeIcon, PlusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { fontDisplay, mono, radii, textSize, tokens, useModuleTranslation, withAlpha } from '../../../../module-sdk';
import type { FleetHost, FleetHostCommand, FleetHostCommandType } from '../../cs2.types';
import { activeCommand, latestProblem, serverState } from '../machineState';
import { CreatingTile, ServerTile } from './ServerTile';
import type { ServerMatch } from './useServerMatches';

const { color } = tokens;

const pending = (c: FleetHostCommand) => c.status === 'pending';

/** Seconds since the epoch, updated each minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The pending command of `type` on this machine (the newest), if any. */
export function runningOf(host: FleetHost, type: FleetHostCommandType): FleetHostCommand | null {
  return host.commands.find((c) => pending(c) && c.type === type) ?? null;
}

/** The Ready Up version most of the machine's servers run. */
export function readyUpVersion(host: FleetHost): string | null {
  const counts = new Map<string, number>();
  for (const s of host.servers) {
    if (s.readyup.installed) counts.set(s.readyup.installed, (counts.get(s.readyup.installed) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function useCommandLabel() {
  const { t } = useModuleTranslation('cs2');
  return (c: FleetHostCommand) => {
    const what = t(`machinesPanel.commands.${c.type.replace(/\./g, '_')}`, { defaultValue: c.type });
    return c.server ? `${what} · ${c.server}` : what;
  };
}

export function useProblemText() {
  const { t } = useModuleTranslation('cs2');
  return (c: FleetHostCommand) =>
    c.errorCode === 'match_in_progress'
      ? t('machinesPanel.refusedMatch', { defaultValue: 'csm refused: a match is in progress' })
      : c.errorCode
        ? `${t(`machinesPanel.errorCodes.${c.errorCode}`, { defaultValue: c.errorCode })}${c.errorMessage ? `. ${c.errorMessage}` : ''}`
        : (c.errorMessage ?? '');
}

/** A version as a chip: "✓ CS2 up to date", or what is new with Update on it, or the update's progress. */
function VersionChip({
  label,
  upToDate,
  running,
  onUpdate,
  updateLabel,
  disabled,
  testId,
  quietAction = false,
}: {
  label: string;
  upToDate: boolean;
  running: FleetHostCommand | null;
  onUpdate: () => void;
  updateLabel: string;
  disabled: boolean;
  testId: string;
  /** Offer the update while up to date too (Ready Up: another release or bundle). */
  quietAction?: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 1,
    minHeight: 30,
    pl: 1.25,
    pr: 0.5,
    borderRadius: radii.pill,
    fontSize: '0.75rem',
    whiteSpace: 'nowrap' as const,
  };
  if (running) {
    return (
      <Box data-testid={`${testId}-progress`} sx={{ ...base, pr: 1.25, bgcolor: withAlpha(color.info, 0.14), color: color.ink }}>
        <Box component="span">{t('serversBoard.updatingWhat', { defaultValue: 'Updating {{what}}', what: label })}</Box>
        <LinearProgress
          variant={running.progress.pct !== null ? 'determinate' : 'indeterminate'}
          value={running.progress.pct ?? 0}
          aria-label={t('machinesPanel.progress', { defaultValue: 'Command progress' })}
          sx={{ width: 64, height: 4, borderRadius: radii.pill }}
        />
        {running.progress.pct !== null && <Box component="span" sx={{ ...mono, color: color.ink2 }}>{Math.round(running.progress.pct)}%</Box>}
      </Box>
    );
  }
  return (
    <Box
      data-testid={testId}
      sx={{ ...base, bgcolor: upToDate ? color.paper3 : withAlpha(color.accent, 0.16), color: color.ink, pr: upToDate && !quietAction ? 1.25 : 0.5 }}
    >
      {upToDate && <CheckIcon size={12} weight="bold" color={color.live} aria-hidden />}
      <Box component="span">{label}</Box>
      {upToDate && quietAction && (
        <Button
          size="small"
          disabled={disabled}
          onClick={onUpdate}
          data-testid={`${testId}-update`}
          sx={{ minHeight: 24, py: 0, px: 1, borderRadius: radii.pill, fontSize: '0.75rem', color: color.ink2 }}
        >
          {updateLabel}
        </Button>
      )}
      {!upToDate && (
        <Button
          size="small"
          variant="contained"
          disabled={disabled}
          onClick={onUpdate}
          data-testid={`${testId}-update`}
          sx={{ minHeight: 24, py: 0, px: 1.25, borderRadius: radii.pill, fontSize: '0.75rem' }}
        >
          {updateLabel}
        </Button>
      )}
    </Box>
  );
}

export interface MachineCardProps {
  host: FleetHost;
  matchByServer: Record<string, ServerMatch>;
  isDeleting: (host: FleetHost, name: string) => boolean;
  onOpenMachine: () => void;
  onOpenServer: (server: string) => void;
  onMenu: (anchor: HTMLElement) => void;
  onAddServers: () => void;
  onUpdateGame: () => void;
  onUpdateReadyUp: () => void;
  onNewCode: () => void;
  onRetry: (c: FleetHostCommand) => void;
}

/**
 * One machine: whether it is online, its CS2 and Ready Up as chips (an
 * update shows its progress in place), its servers as tiles, the servers csm
 * is creating, and the last thing that went wrong with a way to try again.
 */
export function MachineCard({
  host,
  matchByServer,
  isDeleting,
  onOpenMachine,
  onOpenServer,
  onMenu,
  onAddServers,
  onUpdateGame,
  onUpdateReadyUp,
  onNewCode,
  onRetry,
}: MachineCardProps) {
  const { t, i18n } = useModuleTranslation('cs2');
  const now = useNow();
  const commandLabel = useCommandLabel();
  const problemText = useProblemText();
  const inv = host.inventory;
  const online = host.status === 'enrolled' && host.online;
  const problem = latestProblem(host);
  const waiting = host.commands.filter(pending).length;
  const ru = readyUpVersion(host);
  const updatingGame = runningOf(host, 'host.update_game');
  const updatingPlugins = runningOf(host, 'host.update_plugins');
  const creating = host.commands.filter((c) => pending(c) && c.type === 'server.create');
  const creatingCount = creating.reduce((n, c) => n + Math.max(1, Number(c.payload.count) || 1), 0);
  const when = (s: number | null | undefined) => (s ? new Date(s * 1000).toLocaleString(i18n.language) : '—');
  // "3 min", "4 h", "2 d": how long ago, short (the clock ticks each minute).
  const since = (s: number) => {
    const d = Math.max(0, Math.floor(now - s));
    return d < 3600 ? `${Math.max(1, Math.round(d / 60))} min` : d < 86400 ? `${Math.round(d / 3600)} h` : `${Math.round(d / 86400)} d`;
  };
  const tone =
    host.status === 'revoked' ? color.ban : host.status === 'pending' ? color.info : online ? (activeCommand(host) ? color.info : color.live) : color.muted;
  const statusText =
    host.status === 'pending'
      ? host.codeExpiresAt
        ? t('machinesPanel.codeExpires', { defaultValue: 'Code valid until {{time}}', time: when(host.codeExpiresAt) })
        : t('machinesPanel.hostStatus.pending', { defaultValue: 'Waiting to be linked' })
      : host.status === 'revoked'
        ? t('machinesPanel.hostStatus.revoked', { defaultValue: 'Revoked' })
        : online
          ? t('machinesPanel.hostStatus.online', { defaultValue: 'Online' })
          : [
              host.lastSeen
                ? t('serversBoard.offlineFor', { defaultValue: 'Offline for {{time}}', time: since(host.lastSeen) })
                : t('machinesPanel.hostStatus.offline', { defaultValue: 'Offline' }),
              waiting > 0 ? t('machinesPanel.waitingFor', { defaultValue: '{{count}} action(s) wait for it', count: waiting }) : null,
            ]
              .filter(Boolean)
              .join(' · ');

  return (
    <Box
      component="article"
      data-testid={`machine-${host.id}`}
      aria-label={host.name}
      sx={{
        p: { xs: 2, md: 2.75 },
        borderRadius: radii.lg,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        opacity: host.status === 'enrolled' && !host.online ? 0.75 : 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '1 1 16rem', minWidth: 0 }}>
          <ButtonBase
            onClick={onOpenMachine}
            data-testid={`machine-open-${host.id}`}
            sx={{
              fontFamily: fontDisplay,
              fontSize: textSize.lg,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              borderRadius: radii.sm,
              px: 0.5,
              '&:hover': { color: color.accent },
              '&.Mui-focusVisible': { outline: `2px solid ${color.focus}` },
            }}
          >
            {host.name}
          </ButtonBase>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: '0.75rem', color: tone, whiteSpace: 'nowrap' }}>
            <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: tone, boxShadow: online ? `0 0 0 3px ${withAlpha(tone, 0.2)}` : 'none' }} />
            {statusText}
          </Box>
          {(host.hostname || host.csmVersion) && (
            <Box component="span" sx={{ ...mono, color: color.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: { xs: 'none', sm: 'inline' } }}>
              {[host.hostname, host.csmVersion ? `csm ${host.csmVersion}` : null].filter(Boolean).join(' · ')}
            </Box>
          )}
        </Box>
        {host.status === 'enrolled' && inv && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <VersionChip
              testId={`machine-cs2-${host.id}`}
              label={
                inv.cs2.update_available
                  ? t('serversBoard.cs2UpdateAvailable', { defaultValue: 'CS2 · update available' })
                  : t('serversBoard.cs2UpToDate', { defaultValue: 'CS2 up to date' })
              }
              upToDate={!inv.cs2.update_available}
              running={updatingGame}
              onUpdate={onUpdateGame}
              updateLabel={t('serversBoard.update', { defaultValue: 'Update' })}
              disabled={!online}
            />
            {ru && (
              <VersionChip
                testId={`machine-readyup-${host.id}`}
                label={t('machinesPanel.readyUp', { defaultValue: 'Ready Up {{version}}', version: ru })}
                upToDate
                quietAction
                running={updatingPlugins}
                onUpdate={onUpdateReadyUp}
                updateLabel={t('serversBoard.updateEllipsis', { defaultValue: 'Update…' })}
                disabled={!online}
              />
            )}
          </Box>
        )}
        {host.status === 'pending' && (
          <Button size="small" variant="outlined" onClick={onNewCode}>
            {t('machinesPanel.newCode', { defaultValue: 'New code' })}
          </Button>
        )}
        <IconButton
          size="small"
          aria-label={t('machinesPanel.more', { defaultValue: 'More for {{name}}', name: host.name })}
          onClick={(e) => onMenu(e.currentTarget)}
          data-testid={`machine-more-${host.id}`}
          sx={{ border: `1px solid ${color.rule}`, borderRadius: radii.sm }}
        >
          <DotsThreeIcon size={18} weight="bold" />
        </IconButton>
      </Box>

      {host.status === 'enrolled' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 11.5rem), 1fr))', gap: 1.25 }}>
          {host.servers.map((s) => {
            const deleting = isDeleting(host, s.name);
            const state = serverState(host, s, deleting);
            const own = host.commands.find((c) => pending(c) && (c.server === s.name || c.payload.server === s.name)) ?? updatingGame ?? updatingPlugins;
            return (
              <ServerTile
                key={s.name}
                host={host}
                server={s}
                state={state}
                match={s.fleetServer ? matchByServer[s.fleetServer.id] ?? null : null}
                command={own}
                onOpen={() => onOpenServer(s.name)}
              />
            );
          })}
          {Array.from({ length: creatingCount }, (_, i) => (
            <CreatingTile key={`creating-${i}`} n={host.servers.length + i + 1} command={creating[0]} />
          ))}
          {online && (
            <ButtonBase
              onClick={onAddServers}
              data-testid={`machine-create-${host.id}`}
              sx={{
                minHeight: 92,
                borderRadius: radii.md,
                border: `1px dashed ${color.rule}`,
                color: color.ink2,
                gap: 1,
                fontSize: textSize.sm,
                '&:hover': { borderColor: color.ink2, color: color.ink },
                '&.Mui-focusVisible': { outline: `2px solid ${color.focus}` },
              }}
            >
              <PlusIcon size={16} />
              {host.servers.length === 0 && creatingCount === 0
                ? t('serversBoard.addFirstServers', { defaultValue: 'Add the first servers' })
                : t('machinesPanel.addServers', { defaultValue: 'Add servers' })}
            </ButtonBase>
          )}
        </Box>
      )}

      {problem && (
        <Box
          role="status"
          data-testid={`machine-problem-${host.id}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: 1.5,
            borderRadius: radii.md,
            bgcolor: withAlpha(color.ban, 0.1),
            border: `1px solid ${withAlpha(color.ban, 0.4)}`,
          }}
        >
          <WarningCircleIcon size={18} color={color.ban} style={{ flex: 'none' }} />
          <Box sx={{ minWidth: 0, flex: 1, fontSize: textSize.sm }}>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {commandLabel(problem)}
            </Box>
            {problemText(problem) && (
              <Box component="span" sx={{ color: color.ink2 }}>
                {' · '}
                {problemText(problem)}
              </Box>
            )}
          </Box>
          {problem.errorCode !== 'match_in_progress' && (
            <Button size="small" variant="outlined" disabled={!host.online} onClick={() => onRetry(problem)} data-testid={`machine-retry-${host.id}`}>
              {t('machinesPanel.tryAgain', { defaultValue: 'Try again' })}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
