/**
 * One server on the Servers page, as a `RowList` row (audit chunk 6): a
 * status dot, the name and one line that says what the server is doing or
 * what is wrong with it, a quiet status chip, and the rest behind an expand
 * (address, versions, both directions of reachability, fix guides) and a row
 * menu (edit, retry initialization, view match). The row itself still opens
 * the edit dialog, or picks the server while selecting.
 */

import React, { useId, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Link,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import type { Server, ServerAllocationInfo } from '../cs2.types';
import {
  FactGrid,
  Row,
  StatusDot,
  mono,
  radii,
  tokens,
  withAlpha,
  useModuleTranslation,
  type Fact,
} from '../../../module-sdk';

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'muted';

const toneColor: Record<Tone, string> = {
  ok: tokens.color.live,
  bad: tokens.color.ban,
  warn: tokens.color.warning,
  info: tokens.color.info,
  muted: tokens.color.ink2,
};

/** The fix guides the tooltips and the details link to. */
const serverDocs = {
  fleetHealth: 'https://docs.autotournament.gg/reference/servers-health',
  pluginDbDown: 'https://docs.autotournament.gg/reference/servers-health#plugin-db-down',
  cs2Outdated: 'https://docs.autotournament.gg/reference/servers-health#cs2-update-required',
  offline: 'https://docs.autotournament.gg/reference/servers-health#server-offline-or-unreachable',
  ipBanned: 'https://docs.autotournament.gg/reference/servers-health#ip-banned-rcon',
  versionMismatch: 'https://docs.autotournament.gg/reference/servers-health#plugin-version-mismatch',
} as const;

const HEARTBEAT_ACTIVE_SECONDS = 5 * 60;

type T = (key: string, options?: Record<string, unknown>) => string;

/** Tooltip body: a bold title, a sentence, and an optional fix-guide link. */
function Tip({ title, body, href, t }: { title: string; body: string; href?: string; t: T }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Typography variant="body2">{body}</Typography>
      {href && (
        <Link
          href={href}
          target="_blank"
          rel="noreferrer"
          underline="hover"
          sx={{ display: 'inline-block', mt: 0.5 }}
        >
          {t('serversPage.tooltips.fixGuide')}
        </Link>
      )}
    </Box>
  );
}

/** A quiet chip (paper-3, mono) whose text carries the tone. */
function QuietChip({ label, tone, testId }: { label: string; tone: Tone; testId?: string }) {
  return (
    <Chip size="small" label={label} data-testid={testId} sx={{ color: toneColor[tone], maxWidth: '100%' }} />
  );
}

/** Whether the plugin sent an event in the last five minutes. */
function isHeartbeatActive(lastSeen: number | null | undefined): boolean {
  return !!lastSeen && Math.floor(Date.now() / 1000) - lastSeen < HEARTBEAT_ACTIVE_SECONDS;
}

/** "Active 3 minutes ago", from the last event the plugin sent. */
function lastActive(lastSeen: number, t: T): string {
  const secondsAgo = Math.floor(Date.now() / 1000) - lastSeen;
  const minutesAgo = Math.floor(secondsAgo / 60);
  const hoursAgo = Math.floor(minutesAgo / 60);
  const daysAgo = Math.floor(hoursAgo / 24);
  if (secondsAgo < 60) return t('serversPage.lastActive.justNow');
  if (minutesAgo < 60) return t('serversPage.lastActive.minutesAgo', { count: minutesAgo });
  if (hoursAgo < 24) return t('serversPage.lastActive.hoursAgo', { count: hoursAgo });
  return t('serversPage.lastActive.daysAgo', { count: daysAgo });
}

export interface ServerRowProps {
  server: Server;
  /** What the allocator says about this server (cooldown), when it answered. */
  allocation?: Pick<ServerAllocationInfo, 'inGraceWindow' | 'secondsUntilReady'>;
  isChecking: boolean;
  selectionMode: boolean;
  selected: boolean;
  retrying: boolean;
  /** Another retry or a status check is running: retrying this one waits. */
  retryDisabled: boolean;
  loadingMatch: boolean;
  /** The plugin version most servers run, for the "differs" chip. */
  mostCommonVersion: string | null;
  hasMultipleVersions: boolean;
  onToggleSelected: () => void;
  onEdit: () => void;
  onRetry: (event: React.MouseEvent) => void;
  onViewMatch: (event: React.MouseEvent) => void;
}

export function ServerRow({
  server,
  allocation,
  isChecking,
  selectionMode,
  selected,
  retrying,
  retryDisabled,
  loadingMatch,
  mostCommonVersion,
  hasMultipleVersions,
  onToggleSelected,
  onEdit,
  onRetry,
  onViewMatch,
}: ServerRowProps) {
  const { t } = useModuleTranslation('cs2');
  const [expanded, setExpanded] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const detailsId = useId();
  const menuId = useId();

  const slug = server.name.replace(/\s+/g, '-').toLowerCase();
  const queuedMatch = (server as Server & { queuedMatch?: string | null }).queuedMatch ?? null;
  const disabled = !server.enabled || server.status === 'disabled';
  // Config sent via RCON but the plugin hasn't sent events yet (lastSeen still null)
  const configSentWaitingForPlugin = server.enabled && !server.lastSeen && !!server.persistentConfigSent;
  // Not initialized: we haven't sent config, or we don't know (no persistentConfigSent)
  const needsInitialization = server.enabled && !server.lastSeen && !server.persistentConfigSent;
  const cs2UpdateRequired = typeof server.cs2RequiredVersion === 'number' && server.enabled;
  const pluginDbDown = server.enabled && server.atDbOk === false;
  const ipBanned = !!server.ipBanned && server.enabled;
  const versionDiffers =
    hasMultipleVersions && !!mostCommonVersion && !!server.pluginVersion && server.pluginVersion !== mostCommonVersion;
  const coolingDown =
    !!allocation?.inGraceWindow && typeof allocation.secondsUntilReady === 'number' && allocation.secondsUntilReady > 0;

  const heartbeatActive = isHeartbeatActive(server.lastSeen);
  const heartbeatStale = !!server.lastSeen && !heartbeatActive;
  const reachableFromApi = server.reachableFromApi;
  const serverCanReachApi = server.serverCanReachApi;

  // The chip: the same states the 2.x card named, drawn quietly.
  let chipLabel: string;
  let chipTone: Tone = 'muted';
  let chipTip: React.ReactNode = null;
  if (isChecking) {
    chipLabel = t('serversPage.statusChip.checking');
  } else if (disabled) {
    chipLabel = t('serversPage.statusChip.disabled');
    chipTip = <Tip t={t} title={t('serversPage.tooltips.disabledTitle')} body={t('serversPage.tooltips.disabledBody')} />;
  } else if (!server.lastSeen) {
    chipLabel = server.persistentConfigSent
      ? t('serversPage.statusChip.noEventsYet')
      : t('serversPage.statusChip.notConfigured');
    chipTone = server.persistentConfigSent ? 'info' : 'bad';
    chipTip = server.persistentConfigSent ? (
      <Tip t={t} title={t('serversPage.tooltips.noEventsTitle')} body={t('serversPage.tooltips.noEventsBody')} href={serverDocs.offline} />
    ) : (
      <Tip t={t} title={t('serversPage.tooltips.notConfiguredTitle')} body={t('serversPage.tooltips.notConfiguredBody')} />
    );
  } else if (heartbeatStale && reachableFromApi === true) {
    chipLabel = t('serversPage.statusChip.onlineIdle');
    chipTone = 'info';
  } else if (server.status !== 'online' && reachableFromApi === false) {
    // Reserve "Offline" for true reachability failure (or when backend marks it offline).
    chipLabel = t('serversPage.statusChip.offline');
    chipTone = 'bad';
    chipTip = <Tip t={t} title={t('serversPage.tooltips.unreachableTitle')} body={t('serversPage.tooltips.unreachableBody')} href={serverDocs.offline} />;
  } else if (reachableFromApi && serverCanReachApi) {
    chipLabel = heartbeatActive ? t('serversPage.statusChip.onlineActive') : t('serversPage.statusChip.onlineOk');
    chipTone = 'ok';
  } else if (reachableFromApi && serverCanReachApi === false) {
    chipLabel = t('serversPage.statusChip.onlineRconOnly');
    chipTone = 'warn';
    chipTip = <Tip t={t} title={t('serversPage.tooltips.webhookTitle')} body={t('serversPage.tooltips.webhookBody')} href={serverDocs.offline} />;
  } else if (reachableFromApi === false) {
    chipLabel = t('serversPage.statusChip.rconFailed');
    chipTone = 'bad';
    chipTip = <Tip t={t} title={t('serversPage.tooltips.unreachableTitle')} body={t('serversPage.tooltips.unreachableBody')} href={serverDocs.offline} />;
  } else {
    chipLabel = t('serversPage.statusChip.online');
    chipTone = 'ok';
  }

  // The one line: what the server is doing, or the most urgent thing wrong.
  let line: string;
  let lineTone: Tone | null = null;
  if (isChecking) {
    line = t('serversPage.notInitialized.checking');
  } else if (disabled) {
    line = t('serversPage.row.disabled');
  } else if (cs2UpdateRequired) {
    line = t('serversPage.chips.cs2UpdateRequired', { version: server.cs2RequiredVersion });
    lineTone = 'bad';
  } else if (needsInitialization) {
    line = t('serversPage.notInitialized.title');
    lineTone = 'bad';
  } else if (configSentWaitingForPlugin) {
    line = t('serversPage.row.waitingForPlugin');
  } else if (chipTone === 'bad') {
    line = t('serversPage.tooltips.unreachableTitle');
    lineTone = 'bad';
  } else if (ipBanned) {
    line = t('serversPage.chips.ipBanned');
    lineTone = 'bad';
  } else if (pluginDbDown) {
    line = t('serversPage.chips.pluginDbDown');
    lineTone = 'bad';
  } else if (server.currentMatch) {
    line = t('serversPage.row.running', { match: server.currentMatch });
  } else if (queuedMatch) {
    line = `${t('serversPage.currentMatch.queuedPrefix')}${queuedMatch}`;
  } else if (coolingDown) {
    line = t('serversPage.allocation.cooldownEta', { seconds: allocation?.secondsUntilReady });
  } else {
    line = t('serversPage.row.ready');
  }

  const dotState = isChecking || configSentWaitingForPlugin
    ? 'loading'
    : disabled
      ? 'free'
      : needsInitialization || (server.status !== 'online' && reachableFromApi === false)
        ? 'error'
        : server.currentMatch
          ? 'live'
          : 'free';

  const reach = (value: boolean | undefined) =>
    isChecking
      ? t('serversPage.connectivity.loading')
      : value === false
        ? t('serversPage.connectivity.unreachable')
        : value
          ? t('serversPage.connectivity.reachable')
          : t('serversPage.connectivity.unknown');

  const facts: Fact[] = [
    {
      key: 'host',
      label: t('serversPage.details.host'),
      value: <Box component="span" sx={{ ...mono, overflowWrap: 'anywhere' }}>{server.host}</Box>,
    },
    { key: 'port', label: t('serversPage.details.port'), value: <Box component="span" sx={mono}>{server.port}</Box> },
    ...(server.hostname ? [{ key: 'name', label: t('serversPage.details.cs2Name'), value: server.hostname }] : []),
    ...(server.pluginVersion
      ? [{ key: 'plugin', label: t('serversPage.details.plugin'), value: `Auto Tournament CS2 v${server.pluginVersion}` }]
      : []),
    ...(typeof server.cs2BuildId === 'number'
      ? [{ key: 'build', label: t('serversPage.details.cs2Build'), value: String(server.cs2BuildId) }]
      : []),
    ...(server.enabled
      ? [
          { key: 'up', label: t('serversPage.connectivity.apiToServer'), value: reach(reachableFromApi) },
          { key: 'down', label: t('serversPage.connectivity.serverToApi'), value: reach(serverCanReachApi) },
        ]
      : []),
    ...(!isChecking && server.pluginStatus && server.status === 'online'
      ? [
          {
            key: 'pluginStatus',
            label: t('serversPage.details.pluginStatus'),
            value: t(`serversPage.pluginStatus.${server.pluginStatus}`, { defaultValue: server.pluginStatus }),
          },
        ]
      : []),
    ...(coolingDown
      ? [
          {
            key: 'cooldown',
            label: t('serversPage.allocation.cooldownLabel'),
            value: t('serversPage.allocation.cooldownEta', { seconds: allocation?.secondsUntilReady }),
          },
        ]
      : []),
    ...(server.lastSeen
      ? [{ key: 'seen', label: t('serversPage.details.lastEvent'), value: lastActive(server.lastSeen, t) }]
      : []),
    { key: 'id', label: t('serversPage.details.id'), value: <Box component="span" sx={mono}>{server.id}</Box> },
  ];

  const problemChips: React.ReactNode[] = [];
  if (cs2UpdateRequired) {
    problemChips.push(
      <Tooltip key="cs2" arrow title={<Tip t={t} title={t('serversPage.cs2Update.title')} body={t('serversPage.tooltips.cs2UpdateBody')} href={serverDocs.cs2Outdated} />}>
        <Chip size="small" label={t('serversPage.chips.cs2UpdateRequired', { version: server.cs2RequiredVersion })} sx={{ color: tokens.color.ban }} />
      </Tooltip>
    );
  }
  if (pluginDbDown) {
    problemChips.push(
      <Tooltip
        key="db"
        arrow
        title={
          <Tip
            t={t}
            title={t('serversPage.tooltips.pluginDbTitle')}
            body={t('serversPage.tooltips.pluginDbBody', { path: 'sudo csm → Tools → Auto Tournament CS2 DB: verify/repair' })}
            href={serverDocs.pluginDbDown}
          />
        }
      >
        <Chip size="small" label={t('serversPage.chips.pluginDbDown')} sx={{ color: tokens.color.ban }} />
      </Tooltip>
    );
  }
  if (ipBanned) {
    problemChips.push(
      <Tooltip key="ban" arrow title={<Tip t={t} title={t('serversPage.tooltips.ipBannedTitle')} body={t('serversPage.tooltips.ipBannedBody')} href={serverDocs.ipBanned} />}>
        <Chip size="small" label={t('serversPage.chips.ipBanned')} sx={{ color: tokens.color.ban }} />
      </Tooltip>
    );
  }
  if (versionDiffers) {
    problemChips.push(
      <Tooltip
        key="version"
        arrow
        title={
          <Tip
            t={t}
            title={t('serversPage.tooltips.versionDiffTitle')}
            body={t('serversPage.tooltips.versionDiffBody', { command: 'sudo csm update-plugins' })}
            href={serverDocs.versionMismatch}
          />
        }
      >
        <Chip size="small" label={t('serversPage.chips.versionMismatch')} sx={{ color: tokens.color.warning }} />
      </Tooltip>
    );
  }

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const chip = <QuietChip label={chipLabel} tone={chipTone} testId={`server-status-${slug}`} />;

  return (
    <Row
      data-testid={`server-card-${slug}`}
      columns={{
        xs: selectionMode ? 'auto auto minmax(0, 1fr) auto auto' : 'auto minmax(0, 1fr) auto auto',
        md: selectionMode
          ? 'auto auto minmax(0, 1fr) auto auto auto auto'
          : 'auto minmax(0, 1fr) auto auto auto auto',
      }}
      onClick={() => (selectionMode ? onToggleSelected() : onEdit())}
      sx={{
        cursor: 'pointer',
        py: 1.5,
        rowGap: 1,
        bgcolor: selected ? tokens.color.paper3 : 'transparent',
        '&:hover': { bgcolor: tokens.color.paper3 },
        '&:first-of-type': { borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' },
        '&:last-of-type': { borderBottomLeftRadius: 'inherit', borderBottomRightRadius: 'inherit' },
      }}
    >
      {selectionMode && (
        <Checkbox
          size="small"
          checked={selected}
          onClick={stop}
          onChange={onToggleSelected}
          slotProps={{ input: { 'aria-label': server.name } }}
          sx={{ m: -1 }}
        />
      )}
      <StatusDot state={dotState} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1" fontWeight={600} noWrap>
          {server.name}
        </Typography>
        <Typography
          variant="body2"
          noWrap
          data-testid={`server-line-${slug}`}
          sx={{ color: lineTone ? toneColor[lineTone] : tokens.color.muted }}
        >
          {line}
        </Typography>
      </Box>
      {/* The address, to tell servers apart at a glance; beside the name
          from 900px, in the details below that. */}
      <Box
        component="span"
        data-testid="server-host"
        sx={{
          ...mono,
          fontSize: '0.75rem',
          color: tokens.color.muted,
          whiteSpace: 'nowrap',
          display: { xs: 'none', md: 'inline' },
        }}
      >
        {server.host}:{server.port}
      </Box>
      <Box
        sx={{
          display: 'flex',
          minWidth: 0,
          // Under the name on a narrow screen.
          order: { xs: 1, md: 0 },
          gridColumn: { xs: selectionMode ? '3 / -1' : '2 / -1', md: 'auto' },
        }}
      >
        {chipTip ? (
          <Tooltip arrow title={chipTip}>
            {chip}
          </Tooltip>
        ) : (
          chip
        )}
      </Box>
      <IconButton
        size="small"
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={t('serversPage.row.details', { name: server.name })}
        data-testid={`server-expand-${slug}`}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((open) => !open);
        }}
        sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
      >
        <ExpandMoreIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={t('serversPage.row.actions', { name: server.name })}
        aria-haspopup="menu"
        aria-controls={menuAnchor ? menuId : undefined}
        aria-expanded={menuAnchor ? 'true' : undefined}
        data-testid={`server-actions-${slug}`}
        onClick={(event) => {
          event.stopPropagation();
          setMenuAnchor(event.currentTarget);
        }}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={() => setMenuAnchor(null)}
        onClick={stop}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onEdit();
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('serversPage.row.edit')}</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={retryDisabled || retrying}
          data-testid={`server-retry-${slug}`}
          onClick={(event) => {
            setMenuAnchor(null);
            onRetry(event);
          }}
        >
          <ListItemIcon>{retrying ? <CircularProgress size={16} /> : <ReplayIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{t('serversPage.row.retryInit')}</ListItemText>
        </MenuItem>
        {server.status === 'online' && server.currentMatch && (
          <MenuItem
            disabled={loadingMatch}
            onClick={(event) => {
              setMenuAnchor(null);
              onViewMatch(event);
            }}
          >
            <ListItemIcon>
              <SportsEsportsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {loadingMatch ? t('serversPage.currentMatch.loading') : t('serversPage.currentMatch.view')}
            </ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* The technical detail, one click away instead of on every row. */}
      <Box
        id={detailsId}
        sx={{ gridColumn: '1 / -1', order: 2, minWidth: 0, cursor: 'auto', display: expanded ? 'block' : 'none' }}
        onClick={stop}
      >
        <Collapse in={expanded} unmountOnExit>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
            {needsInitialization && (
              <Box
                sx={{
                  bgcolor: withAlpha(tokens.color.ban, 0.1),
                  border: `1px solid ${withAlpha(tokens.color.ban, 0.45)}`,
                  borderRadius: radii.md,
                  p: 1.5,
                }}
              >
                <Typography variant="body2" fontWeight={600}>
                  {t('serversPage.notInitialized.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {isChecking
                    ? t('serversPage.notInitialized.checking')
                    : reachableFromApi === false
                      ? t('serversPage.notInitialized.rconUnreachable')
                      : reachableFromApi === true
                        ? t('serversPage.notInitialized.noEvents')
                        : t('serversPage.notInitialized.notChecked')}
                </Typography>
                {!isChecking && reachableFromApi === true && (
                  <Typography variant="body2" color="text.secondary" mt={0.5}>
                    {t('serversPage.checkServerLogs')}
                  </Typography>
                )}
              </Box>
            )}
            {cs2UpdateRequired && (
              <Typography variant="body2" color="text.secondary">
                required_version={server.cs2RequiredVersion}
                {server.cs2UpdatePhase ? ` • phase=${server.cs2UpdatePhase}` : ''}
              </Typography>
            )}
            {problemChips.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{problemChips}</Box>
            )}
            <FactGrid variant="fact" items={facts} minCellWidth={170} aria-label={server.name} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {server.status === 'online' && server.currentMatch && (
                <Button size="small" variant="outlined" onClick={onViewMatch} disabled={loadingMatch}>
                  {loadingMatch ? t('serversPage.currentMatch.loading') : t('serversPage.currentMatch.view')}
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                startIcon={retrying ? <CircularProgress size={16} /> : <ReplayIcon />}
                onClick={onRetry}
                disabled={retryDisabled || retrying}
              >
                {t('serversPage.row.retryInit')}
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Box>
    </Row>
  );
}
