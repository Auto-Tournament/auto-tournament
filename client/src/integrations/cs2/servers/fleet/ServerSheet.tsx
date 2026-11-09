import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { ArrowClockwiseIcon, PlayIcon, StopIcon, TrashIcon } from '@phosphor-icons/react';
import {
  mono,
  openMatchDetails,
  tokens,
  useModuleTranslation,
  fmtDateTime,
} from '../../../../module-sdk';
import type { FleetHost, FleetHostServer } from '../../cs2.types';
import { getMapDisplayName } from '../../maps/mapData';
import { serverState } from '../machineState';
import { Facts, SideSheet } from './SideSheet';
import { StateMark, useStateLabel } from './ServerTile';
import type { Fleet } from './useFleet';
import type { ServerMatch } from './useServerMatches';

const { color } = tokens;

/**
 * One server's details and what can be done to it. Start, restart and stop
 * show on the tile and here at once; csm's answer follows over the socket.
 * Deleting asks first, and csm only deletes the last server on a machine
 * (it keeps server-1..N contiguous).
 */
export function ServerSheet({
  fleet,
  host,
  serverName,
  match,
  onClose,
  onDelete,
}: {
  fleet: Fleet;
  host: FleetHost | null;
  serverName: string | null;
  match: ServerMatch | null;
  onClose: () => void;
  onDelete: (host: FleetHost, server: string) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const label = useStateLabel();
  const s = host && serverName ? (host.servers.find((x) => x.name === serverName) ?? null) : null;
  const open = !!host && !!s;
  const deleting = host && s ? fleet.isDeleting(host, s.name) : false;
  const state = host && s ? serverState(host, s, deleting) : 'offline';
  const canAct = !!host?.online && !deleting;
  const last = host && s ? host.servers[host.servers.length - 1]?.name === s.name : false;
  const since = s?.process.started_at ? fmtDateTime(s.process.started_at) : null;

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      testId="server-sheet"
      title={s ? (s.fleetServer?.name ?? s.name) : ''}
      subtitle={host ? `${host.name} · ${s?.name ?? ''}` : undefined}
    >
      {host && s && (
        <>
          <Facts
            items={[
              [
                t('serversBoard.facts.state', { defaultValue: 'State' }),
                <Box
                  key="state"
                  component="span"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
                >
                  <StateMark state={state} />
                  {label(state, match)}
                </Box>,
              ],
              match && [
                t('serversBoard.facts.match', { defaultValue: 'Match' }),
                <Box key="match" component="span">
                  {match.team1 || match.team2 ? `${match.team1} vs ${match.team2}` : match.slug}
                  {match.score && match.phase !== 'veto'
                    ? ` · ${match.score[0]} – ${match.score[1]}`
                    : ''}
                  {match.map ? ` · ${getMapDisplayName(match.map)}` : ''}
                </Box>,
              ],
              [
                t('serversBoard.facts.ports', { defaultValue: 'Ports' }),
                <Box key="ports" component="span" sx={mono}>
                  {[`game ${s.game_port}`, s.tv_port ? `GOTV ${s.tv_port}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Box>,
              ],
              [
                'Ready Up',
                s.readyup.installed
                  ? [
                      s.readyup.installed,
                      t(`machinesPanel.health.${s.readyup.health}`, {
                        defaultValue: s.readyup.health,
                      }),
                      s.readyup.phase ?? null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : t('machinesPanel.noReadyUp', { defaultValue: 'No Ready Up' }),
              ],
              [
                t('serversBoard.facts.link', { defaultValue: 'Platform link' }),
                s.fleetServer
                  ? s.fleetServer.online
                    ? t('serversBoard.linkOnline', { defaultValue: 'Connected' })
                    : t('serversBoard.linkOffline', { defaultValue: 'Not connected' })
                  : t('serversBoard.linkNone', { defaultValue: 'Not enrolled yet' }),
              ],
              !!since && [t('serversBoard.facts.since', { defaultValue: 'Running since' }), since],
              s.process.restarts_24h > 0 && [
                t('serversBoard.facts.restarts', { defaultValue: 'Restarts (24 h)' }),
                String(s.process.restarts_24h),
              ],
              typeof s.process.cpu_pct === 'number' && [
                t('serversBoard.facts.usage', { defaultValue: 'CPU · memory' }),
                `${Math.round(s.process.cpu_pct)}% · ${Math.round(s.process.rss_mb ?? 0)} MB`,
              ],
            ]}
          />

          <Stack direction="row" gap={1} flexWrap="wrap">
            {match && (
              <Button
                variant="contained"
                size="small"
                onClick={() => void openMatchDetails(match.slug)}
                data-testid="server-sheet-match"
              >
                {t('serversBoard.openMatch', { defaultValue: 'Open the match' })}
              </Button>
            )}
            {!s.process.running ? (
              <Button
                size="small"
                variant={match ? 'outlined' : 'contained'}
                startIcon={<PlayIcon />}
                disabled={!canAct}
                onClick={() => void fleet.send(host, 'server.start', { server: s.name })}
                data-testid={`machine-start-${s.name}`}
              >
                {t('machinesPanel.start', { defaultValue: 'Start' })}
              </Button>
            ) : (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ArrowClockwiseIcon />}
                  disabled={!canAct}
                  onClick={() =>
                    void fleet.send(host, 'server.restart', {
                      server: s.name,
                      reason: 'restart from the Servers page',
                    })
                  }
                  data-testid={`machine-restart-${s.name}`}
                >
                  {t('machinesPanel.restart', { defaultValue: 'Restart' })}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<StopIcon />}
                  disabled={!canAct}
                  onClick={() => void fleet.send(host, 'server.stop', { server: s.name })}
                  data-testid={`machine-stop-${s.name}`}
                >
                  {t('machinesPanel.stop', { defaultValue: 'Stop' })}
                </Button>
              </>
            )}
            {last && (
              <Button
                size="small"
                color="error"
                startIcon={<TrashIcon />}
                disabled={!canAct}
                onClick={() => onDelete(host, s.name)}
                data-testid={`machine-delete-${s.name}`}
              >
                {t('machinesPanel.deleteServer', { defaultValue: 'Delete server' })}
              </Button>
            )}
          </Stack>
          {host.capabilities.includes('servers.launch_args') && (
            <LaunchOptions
              key={`${s.name}:${(s.extra_launch_args ?? []).join(' ')}`}
              fleet={fleet}
              host={host}
              server={s}
              disabled={!canAct}
            />
          )}
          {match && s.process.running && (
            <Typography variant="body2" sx={{ color: color.muted }}>
              {t('serversBoard.matchHint', {
                defaultValue:
                  'A match is on this server: stopping or restarting it asks for a reason, and failover can move the match first.',
              })}
            </Typography>
          )}
          {!last && (
            <Typography variant="caption" sx={{ color: color.muted }}>
              {t('serversBoard.deleteLastOnly', {
                defaultValue:
                  'csm deletes the last server on a machine only, so the numbers stay in order.',
              })}
            </Typography>
          )}
        </>
      )}
    </SideSheet>
  );
}

/** The server's extra CS2 launch arguments (csm's server.set_launch_args); keyed on the saved value, so a new inventory resets the field. */
function LaunchOptions({
  fleet,
  host,
  server,
  disabled,
}: {
  fleet: Fleet;
  host: FleetHost;
  server: FleetHostServer;
  disabled: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const saved = (server.extra_launch_args ?? []).join(' ');
  const [value, setValue] = useState(saved);
  const args = value.trim() ? value.trim().split(/\s+/) : [];
  const changed = args.join(' ') !== saved;
  return (
    <Stack gap={1}>
      <TextField
        size="small"
        label={t('serversBoard.launch.label', { defaultValue: 'Launch options' })}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="+exec my_settings.cfg"
        helperText={t('serversBoard.launch.hint', {
          defaultValue:
            'Extra CS2 launch arguments, separated by spaces. Saving restarts the server if it is running.',
        })}
        disabled={disabled}
        slotProps={{
          htmlInput: {
            spellCheck: false,
            style: mono,
            'data-testid': `launch-options-${server.name}`,
          },
        }}
      />
      <Box>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled || !changed}
          onClick={() =>
            void fleet.send(host, 'server.set_launch_args', { server: server.name, args })
          }
          data-testid={`launch-options-save-${server.name}`}
        >
          {t('serversBoard.launch.save', { defaultValue: 'Save launch options' })}
        </Button>
      </Box>
    </Stack>
  );
}
