import type { ReactNode } from 'react';
import { Box, Button, ButtonBase, IconButton, LinearProgress } from '@mui/material';
import { CheckIcon, DotsThreeIcon, PlusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import {
  fontDisplay,
  mono,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  withAlpha,
  panelSx,
  panelBorderSx,
} from '../../../../module-sdk';
import type { FleetHost, FleetHostCommand, FleetHostCommandType } from '../../cs2.types';
import { activeCommand, latestProblem } from '../machineState';
import { StateMark } from './serverStateMark';
import { formatAgo, formatWhen, useNow } from '../time';

const { color } = tokens;

const pending = (c: FleetHostCommand) => c.status === 'pending';

/** The pending command of `type` on this machine (the newest), if any. */
export function runningOf(host: FleetHost, type: FleetHostCommandType): FleetHostCommand | null {
  return host.commands.find((c) => pending(c) && c.type === type) ?? null;
}

/** The Ready Up version most of the machine's servers run. */
export function readyUpVersion(host: FleetHost): string | null {
  const counts = new Map<string, number>();
  for (const s of host.servers) {
    if (s.readyup.installed)
      counts.set(s.readyup.installed, (counts.get(s.readyup.installed) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function useCommandLabel() {
  const { t } = useModuleTranslation('cs2');
  return (c: FleetHostCommand) => {
    const what = t(`machinesPanel.commands.${c.type.replace(/\./g, '_')}`, {
      defaultValue: c.type,
    });
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
      <Box
        data-testid={`${testId}-progress`}
        sx={{ ...base, pr: 1.25, bgcolor: withAlpha(color.info, 0.14), color: color.ink }}
      >
        <Box component="span">
          {t('serversBoard.updatingWhat', { defaultValue: 'Updating {{what}}', what: label })}
        </Box>
        <LinearProgress
          variant={running.progress.pct !== null ? 'determinate' : 'indeterminate'}
          value={running.progress.pct ?? 0}
          aria-label={t('machinesPanel.progress', { defaultValue: 'Command progress' })}
          sx={{ width: 64, height: 4, borderRadius: radii.pill }}
        />
        {running.progress.pct !== null && (
          <Box component="span" sx={{ ...mono, color: color.ink2 }}>
            {Math.round(running.progress.pct)}%
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box
      data-testid={testId}
      sx={{
        ...base,
        bgcolor: upToDate ? color.paper3 : withAlpha(color.accent, 0.16),
        color: color.ink,
        pr: upToDate && !quietAction ? 1.25 : 0.5,
      }}
    >
      {upToDate && <CheckIcon size={12} weight="bold" color={color.live} aria-hidden />}
      <Box component="span">{label}</Box>
      {upToDate && quietAction && (
        <Button
          size="small"
          disabled={disabled}
          onClick={onUpdate}
          data-testid={`${testId}-update`}
          sx={{
            minHeight: 24,
            py: 0,
            px: 1,
            borderRadius: radii.pill,
            fontSize: '0.75rem',
            color: color.ink2,
          }}
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
  onOpenMachine: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onAddServers: () => void;
  onUpdateGame: () => void;
  onUpdateReadyUp: () => void;
  onNewCode: () => void;
  onRetry: (c: FleetHostCommand) => void;
  /** Its servers, one row each. */
  children?: ReactNode;
}

/**
 * One machine: whether it is online, its CS2 and Ready Up as chips (an
 * update shows its progress in place), its servers (`children`), the servers
 * csm is creating, and the last thing that went wrong with a way to try again.
 */
export function MachineCard({
  host,
  onOpenMachine,
  onMenu,
  onAddServers,
  onUpdateGame,
  onUpdateReadyUp,
  onNewCode,
  onRetry,
  children,
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
  const when = (s: number | null | undefined) => formatWhen(s);
  const tone =
    host.status === 'revoked'
      ? color.ban
      : host.status === 'pending'
        ? color.info
        : online
          ? activeCommand(host)
            ? color.info
            : color.live
          : color.muted;
  const statusText =
    host.status === 'pending'
      ? host.codeExpiresAt
        ? t('machinesPanel.codeExpires', {
            defaultValue: 'Code valid until {{time}}',
            time: when(host.codeExpiresAt),
          })
        : // A pending machine always gets a code; none left means it expired.
          t('machinesPanel.codeExpired', { defaultValue: 'Code expired: get a new one' })
      : host.status === 'revoked'
        ? t('machinesPanel.hostStatus.revoked', { defaultValue: 'Revoked' })
        : online
          ? t('machinesPanel.hostStatus.online', { defaultValue: 'Online' })
          : [
              host.lastSeen
                ? t('serversBoard.offlineLastSeen', {
                    defaultValue: 'Offline, last seen {{time}}',
                    time: formatAgo(host.lastSeen, i18n.language, now),
                  })
                : t('machinesPanel.hostStatus.offline', { defaultValue: 'Offline' }),
              waiting > 0
                ? t('machinesPanel.waitingFor', {
                    defaultValue: '{{count}} action(s) wait for it',
                    count: waiting,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ');

  return (
    <Box
      component="article"
      data-testid={`machine-${host.id}`}
      aria-label={host.name}
      sx={{
        ...panelSx,
        ...panelBorderSx,
        p: { xs: 1.5, md: 2 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        opacity: host.status === 'enrolled' && !host.online ? 0.75 : 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            columnGap: 1.25,
            rowGap: 0.25,
            flexWrap: 'wrap',
            flex: '1 1 16rem',
            minWidth: 0,
          }}
        >
          <ButtonBase
            onClick={onOpenMachine}
            data-testid={`machine-open-${host.id}`}
            title={host.name}
            sx={{
              fontFamily: fontDisplay,
              fontSize: textSize.lg,
              fontWeight: 600,
              minWidth: 0,
              maxWidth: '100%',
              borderRadius: radii.sm,
              px: 0.5,
              '&:hover': { color: color.accent },
              '&.Mui-focusVisible': { outline: `2px solid ${color.focus}` },
            }}
          >
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {host.name}
            </Box>
          </ButtonBase>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              fontSize: '0.75rem',
              color: tone === color.muted ? color.ink2 : tone,
              minWidth: 0,
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                flex: 'none',
                borderRadius: radii.pill,
                bgcolor: tone,
                boxShadow: online ? `0 0 0 3px ${withAlpha(tone, 0.2)}` : 'none',
              }}
            />
            {statusText}
          </Box>
          {(host.hostname || host.csmVersion) && (
            // ink2, not muted: muted on the card's surface is under 4.5:1 (axe, 2026-10-12).
            <Box
              component="span"
              sx={{
                ...mono,
                color: color.ink2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: { xs: 'none', sm: 'inline' },
              }}
            >
              {[host.hostname, host.csmVersion ? `csm ${host.csmVersion}` : null]
                .filter(Boolean)
                .join(' · ')}
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
                label={t('machinesPanel.readyUp', {
                  defaultValue: 'Ready Up {{version}}',
                  version: ru,
                })}
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
        {online && (
          <Button
            size="small"
            startIcon={<PlusIcon size={14} />}
            onClick={onAddServers}
            data-testid={`machine-create-${host.id}`}
          >
            {t('machinesPanel.addServers', { defaultValue: 'Add servers' })}
          </Button>
        )}
        {host.status === 'pending' && (
          <Button size="small" variant="outlined" onClick={onNewCode}>
            {t('machinesPanel.newCode', { defaultValue: 'New code' })}
          </Button>
        )}
        <IconButton
          size="small"
          aria-label={t('machinesPanel.more', {
            defaultValue: 'More for {{name}}',
            name: host.name,
          })}
          onClick={(e) => onMenu(e.currentTarget)}
          data-testid={`machine-more-${host.id}`}
          sx={{ border: `1px solid ${color.rule}`, borderRadius: radii.sm }}
        >
          <DotsThreeIcon size={18} weight="bold" />
        </IconButton>
      </Box>

      {children}
      {creating.length > 0 && (
        <Box role="list">
          {Array.from({ length: creatingCount }, (_, i) => (
            <Box
              key={`creating-${i}`}
              role="listitem"
              data-testid="machine-row-creating"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                minHeight: 40,
                fontSize: textSize.sm,
                color: color.ink2,
              }}
            >
              <StateMark state="starting" />
              <Box component="span" sx={{ fontWeight: 600 }}>
                {t('serversBoard.newServer', {
                  defaultValue: 'New server {{n}}',
                  n: host.servers.length + i + 1,
                })}
              </Box>
              <Box
                component="span"
                sx={{
                  color: color.muted,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {creating[0].progress.step ??
                  t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' })}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {online && host.servers.length === 0 && creatingCount === 0 && (
        <Box component="span" sx={{ px: 1.5, fontSize: textSize.sm, color: color.muted }}>
          {t('serversBoard.addFirstServers', { defaultValue: 'Add the first servers' })}
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
            <Button
              size="small"
              variant="outlined"
              disabled={!host.online}
              onClick={() => onRetry(problem)}
              data-testid={`machine-retry-${host.id}`}
            >
              {t('machinesPanel.tryAgain', { defaultValue: 'Try again' })}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
