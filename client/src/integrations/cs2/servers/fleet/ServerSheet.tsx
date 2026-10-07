import { Box, Button, Stack, Typography } from '@mui/material';
import { ArrowClockwiseIcon, PlayIcon, StopIcon, TrashIcon } from '@phosphor-icons/react';
import { mono, openMatchDetails, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { FleetHost } from '../../cs2.types';
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
  const { t, i18n } = useModuleTranslation('cs2');
  const label = useStateLabel();
  const s = host && serverName ? host.servers.find((x) => x.name === serverName) ?? null : null;
  const open = !!host && !!s;
  const deleting = host && s ? fleet.isDeleting(host, s.name) : false;
  const state = host && s ? serverState(host, s, deleting) : 'offline';
  const canAct = !!host?.online && !deleting;
  const last = host && s ? host.servers[host.servers.length - 1]?.name === s.name : false;
  const since = s?.process.started_at
    ? new Date(s.process.started_at * 1000).toLocaleString(i18n.language)
    : null;

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
                <Box key="state" component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <StateMark state={state} />
                  {label(state, match)}
                </Box>,
              ],
              match && [
                t('serversBoard.facts.match', { defaultValue: 'Match' }),
                <Box key="match" component="span">
                  {match.team1 || match.team2 ? `${match.team1} vs ${match.team2}` : match.slug}
                  {match.score && match.phase !== 'veto' ? ` · ${match.score[0]} – ${match.score[1]}` : ''}
                  {match.map ? ` · ${getMapDisplayName(match.map)}` : ''}
                </Box>,
              ],
              [
                t('serversBoard.facts.ports', { defaultValue: 'Ports' }),
                <Box key="ports" component="span" sx={mono}>
                  {[`game ${s.game_port}`, s.tv_port ? `GOTV ${s.tv_port}` : null].filter(Boolean).join(' · ')}
                </Box>,
              ],
              [
                'Ready Up',
                s.readyup.installed
                  ? [
                      s.readyup.installed,
                      t(`machinesPanel.health.${s.readyup.health}`, { defaultValue: s.readyup.health }),
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
              <Button variant="contained" size="small" onClick={() => void openMatchDetails(match.slug)} data-testid="server-sheet-match">
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
                  onClick={() => void fleet.send(host, 'server.restart', { server: s.name, reason: 'restart from the Servers page' })}
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
          {match && s.process.running && (
            <Typography variant="body2" sx={{ color: color.muted }}>
              {t('serversBoard.matchHint', {
                defaultValue: 'A match is on this server: stopping or restarting it asks for a reason, and failover can move the match first.',
              })}
            </Typography>
          )}
          {!last && (
            <Typography variant="caption" sx={{ color: color.muted }}>
              {t('serversBoard.deleteLastOnly', { defaultValue: 'csm deletes the last server on a machine only, so the numbers stay in order.' })}
            </Typography>
          )}
        </>
      )}
    </SideSheet>
  );
}
