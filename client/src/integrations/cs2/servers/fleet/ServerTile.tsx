import { Box, ButtonBase, CircularProgress } from '@mui/material';
import { mono, radii, textSize, tokens, useModuleTranslation, withAlpha } from '../../../../module-sdk';
import type { FleetHost, FleetHostCommand, FleetHostServer } from '../../cs2.types';
import { getMapDisplayName } from '../../maps/mapData';
import type { ServerTileState } from '../machineState';
import type { ServerMatch } from './useServerMatches';

const { color } = tokens;

/** A state's colour: free is green, a match the accent, anything in motion blue, the rest muted. */
export const stateTone: Record<ServerTileState, string> = {
  free: color.live,
  match: color.accent,
  starting: color.info,
  stopping: color.info,
  restarting: color.info,
  updating: color.info,
  deleting: color.muted,
  stopped: color.muted,
  offline: color.ban,
};

export const MOVING: ServerTileState[] = ['starting', 'stopping', 'restarting', 'updating', 'deleting'];

export function useStateLabel() {
  const { t } = useModuleTranslation('cs2');
  return (state: ServerTileState, match?: ServerMatch | null) => {
    if (state === 'match' && match?.phase === 'veto') return t('serversBoard.state.veto', { defaultValue: 'Veto' });
    if (state === 'match' && match?.phase === 'warmup') return t('serversBoard.state.warmup', { defaultValue: 'Warmup' });
    return t(`serversBoard.state.${state}`, {
      defaultValue: {
        free: 'Free',
        match: 'Match',
        starting: 'Starting…',
        stopping: 'Stopping…',
        restarting: 'Restarting…',
        updating: 'Updating…',
        deleting: 'Deleting…',
        stopped: 'Stopped',
        offline: 'Down',
      }[state],
    });
  };
}

/** The dot or, while something happens to the server, a small spinner. */
export function StateMark({ state, size = 8 }: { state: ServerTileState; size?: number }) {
  if (MOVING.includes(state)) {
    return <CircularProgress size={size + 4} thickness={6} sx={{ color: stateTone[state], flex: 'none' }} aria-hidden />;
  }
  return <Box aria-hidden sx={{ width: size, height: size, borderRadius: radii.pill, bgcolor: stateTone[state], flex: 'none' }} />;
}

export interface ServerTileProps {
  host: FleetHost;
  server: FleetHostServer;
  state: ServerTileState;
  match: ServerMatch | null;
  /** The command csm is running for this server, for its progress. */
  command: FleetHostCommand | null;
  onOpen: () => void;
}

/**
 * One server on its machine: its name, its state as a colour and a word, and
 * one or two lines of what it is doing (the match on it, or how far csm is).
 * Clicking opens it.
 */
export function ServerTile({ host, server, state, match, command, onOpen }: ServerTileProps) {
  const { t } = useModuleTranslation('cs2');
  const label = useStateLabel();
  const name = server.fleetServer?.name ?? server.name;
  const lines: string[] = [];
  if (state === 'match' && match) {
    if (match.team1 || match.team2) {
      lines.push(
        [`${match.team1} vs ${match.team2}`, match.score && match.phase !== 'veto' ? `${match.score[0]} – ${match.score[1]}` : null]
          .filter(Boolean)
          .join(' · ')
      );
    }
    const where = [
      match.map ? getMapDisplayName(match.map) : null,
      match.maps > 1 && match.mapNumber !== null
        ? t('serversBoard.mapOf', { defaultValue: 'Map {{n}} of {{count}}', n: match.mapNumber + 1, count: match.maps })
        : null,
    ].filter(Boolean);
    if (where.length) lines.push(where.join(' · '));
  } else if (MOVING.includes(state) && command) {
    lines.push(
      command.progress.step ??
        (command.seq === null
          ? t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' })
          : t('serversBoard.csmOnIt', { defaultValue: 'csm is on it' }))
    );
  } else if (state === 'stopped') {
    lines.push(t('serversBoard.stoppedLine', { defaultValue: 'Starts when a match needs it' }));
  } else if (state === 'offline') {
    lines.push(
      host.online
        ? t('serversBoard.notAnswering', { defaultValue: 'Not answering' })
        : t('serversBoard.machineOffline', { defaultValue: 'Its machine is offline' })
    );
  } else {
    lines.push(`:${server.game_port}`);
  }
  if (server.process.restarts_24h > 0 && state !== 'match') {
    lines.push(t('serversBoard.restarts', { defaultValue: '{{count}} restarts in 24 h', count: server.process.restarts_24h }));
  }
  const pct = MOVING.includes(state) ? command?.progress.pct ?? null : null;

  return (
    <ButtonBase
      onClick={onOpen}
      data-testid={`machine-tile-${host.id}-${server.name}`}
      data-state={state}
      aria-label={`${name}: ${label(state, match)}`}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'left',
        gap: 0.5,
        p: 1.5,
        minHeight: 92,
        borderRadius: radii.md,
        bgcolor: color.paper,
        // Down is red only on an online machine: an offline one says so itself.
        border: `1px solid ${
          state === 'match' ? withAlpha(color.accent, 0.55) : state === 'offline' && host.online ? withAlpha(color.ban, 0.6) : color.rule
        }`,
        opacity: state === 'deleting' ? 0.55 : 1,
        '&:hover': { borderColor: color.muted },
        '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box component="span" sx={{ fontWeight: 600, fontSize: textSize.sm, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </Box>
        <Box
          component="span"
          data-testid={`machine-state-${server.name}`}
          sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: '0.75rem', color: color.ink2, whiteSpace: 'nowrap' }}
        >
          {state === 'offline' && !host.online ? (
            <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: color.muted, flex: 'none' }} />
          ) : (
            <StateMark state={state} />
          )}
          {label(state, match)}
        </Box>
      </Box>
      {lines.map((line, i) => (
        <Box
          key={i}
          component="span"
          sx={{
            fontSize: '0.75rem',
            color: i === 0 && state === 'match' ? color.ink : color.muted,
            ...(line.startsWith(':') ? mono : {}),
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {line}
        </Box>
      ))}
      {pct !== null && (
        <Box aria-hidden sx={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.max(4, pct)}%`, bgcolor: color.info, transition: 'width 240ms ease-out' }} />
      )}
    </ButtonBase>
  );
}

/** A server csm is creating: a tile before it exists, so "Add servers" shows at once. */
export function CreatingTile({ n, command }: { n: number; command: FleetHostCommand }) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box
      data-testid="machine-tile-creating"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 1.5,
        minHeight: 92,
        borderRadius: radii.md,
        border: `1px dashed ${withAlpha(color.info, 0.6)}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ fontWeight: 600, fontSize: textSize.sm, color: color.ink2 }}>
          {t('serversBoard.newServer', { defaultValue: 'New server {{n}}', n })}
        </Box>
        <Box component="span" sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: '0.75rem', color: color.ink2 }}>
          <StateMark state="starting" />
          {t('serversBoard.state.creating', { defaultValue: 'Creating…' })}
        </Box>
      </Box>
      <Box component="span" sx={{ fontSize: '0.75rem', color: color.muted }}>
        {command.progress.step ?? t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' })}
      </Box>
      {command.progress.pct !== null && (
        <Box aria-hidden sx={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.max(4, command.progress.pct)}%`, bgcolor: color.info }} />
      )}
    </Box>
  );
}
