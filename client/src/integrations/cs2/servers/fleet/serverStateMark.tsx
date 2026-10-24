import { Box, Chip, CircularProgress } from '@mui/material';
import { radii, tokens, useModuleTranslation } from '../../../../module-sdk';
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

export const MOVING: ServerTileState[] = [
  'starting',
  'stopping',
  'restarting',
  'updating',
  'deleting',
];

export function useStateLabel() {
  const { t } = useModuleTranslation('cs2');
  return (state: ServerTileState, match?: ServerMatch | null) => {
    if (state === 'match' && match?.phase === 'veto')
      return t('serversBoard.state.veto', { defaultValue: 'Veto' });
    if (state === 'match' && match?.phase === 'warmup')
      return t('serversBoard.state.warmup', { defaultValue: 'Warmup' });
    if (state === 'match' && match?.phase === 'knife')
      return t('serversBoard.state.knife', { defaultValue: 'Knife' });
    if (state === 'match' && match?.phase === 'live')
      return t('serversBoard.state.live', { defaultValue: 'Live' });
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

const dash = (pair: [number, number]) => `${pair[0]} – ${pair[1]}`;

/** The map with its score; the score waits for the match to be played, the map for the veto. */
function mapPart(m: ServerMatch): string | null {
  if (m.phase === 'veto') return null;
  const score = m.score && m.phase !== 'warmup' ? dash(m.score) : null;
  if (m.map) return score ? `${m.map} ${score}` : m.map;
  return score;
}

const teamsPart = (m: ServerMatch) => (m.team1 || m.team2 ? `${m.team1} vs ${m.team2}` : null);

/** One line on a match: the teams, the map with its score, how far the series is. */
export function useMatchLine() {
  const { t } = useModuleTranslation('cs2');
  return (m: ServerMatch): string => {
    const parts: string[] = [];
    const teams = teamsPart(m);
    if (teams) parts.push(teams);
    const map = mapPart(m);
    if (map) parts.push(map);
    if (m.maps > 1 && m.mapNumber !== null) {
      const of = t('serversBoard.mapOf', {
        defaultValue: 'Map {{n}} of {{count}}',
        n: m.mapNumber + 1,
        count: m.maps,
      });
      parts.push(m.series ? `${of} (${dash(m.series)})` : of);
    }
    return parts.join(' · ');
  };
}

/** A tile's line on a match: its bracket label (else the teams, else the slug), the map with its score, the series. */
export function useTileMatchLine() {
  return (m: ServerMatch, bracketLabel: string | null): string => {
    const parts = [bracketLabel || teamsPart(m) || m.slug];
    const map = mapPart(m);
    if (map) parts.push(map);
    if (m.maps > 1 && m.series) parts.push(dash(m.series));
    return parts.join(' · ');
  };
}

/** The dot or, while something happens to the server, a small spinner. */
export function StateMark({ state, size = 8 }: { state: ServerTileState; size?: number }) {
  if (MOVING.includes(state)) {
    return (
      <CircularProgress
        size={size + 4}
        thickness={6}
        sx={{ color: stateTone[state], flex: 'none' }}
        aria-hidden
      />
    );
  }
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: radii.pill,
        bgcolor: stateTone[state],
        flex: 'none',
      }}
    />
  );
}

/** A state word as a chip in its state's colour; its full text on hover when the column cuts it. */
export function StateChip({ label, tone }: { label: string; tone: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      title={label}
      sx={{ color: tone, borderColor: tone, maxWidth: '100%' }}
    />
  );
}
