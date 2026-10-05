import { Box } from '@mui/material';
import { tokens, withAlpha } from '../../../module-sdk';
import { getMapDisplayName } from '../maps/mapData';

export interface MapResult {
  map: string;
  played: number;
  won: number;
  roundsWon: number;
  roundsLost: number;
}

/**
 * How strong a player is on a map, 0..1: the share of rounds won, pulled
 * towards an even 50% while few rounds are on record (five won and five lost
 * added), so one lucky map does not top the chart.
 */
export function mapStrength(m: MapResult): number {
  return (m.roundsWon + 5) / (m.roundsWon + m.roundsLost + 10);
}

const SIZE = 460;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 150;

/** 30% of rounds won sits at the centre, 70% at the rim. */
const radius = (strength: number) => Math.max(0.04, Math.min(1, (strength - 0.3) / 0.4));

function point(i: number, n: number, r: number): [number, number] {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return [CX + R * r * Math.cos(a), CY + R * r * Math.sin(a)];
}

const pts = (list: Array<[number, number]>) =>
  list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/**
 * The map strength radar: one spoke per map the player played (three or
 * more), like CS2's own map ratings. Name labels at the rim.
 */
export function MapRadar({ maps, label }: { maps: MapResult[]; label: string }) {
  const played = maps.filter((m) => m.played > 0);
  const n = played.length;
  const rings = [0.25, 0.5, 0.75, 1].map((k) => pts(played.map((_, i) => point(i, n, k))));
  const shape = played.map((m, i) => point(i, n, radius(mapStrength(m))));

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={label}
      sx={{
        width: '100%',
        maxWidth: SIZE,
        height: 'auto',
        display: 'block',
        mx: 'auto',
        overflow: 'visible',
      }}
    >
      {rings.map((ring, i) => (
        <polygon key={i} points={ring} fill="none" stroke={tokens.color.rule} strokeWidth="1" />
      ))}
      {played.map((_, i) => {
        const [x, y] = point(i, n, 1);
        return (
          <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke={tokens.color.rule} strokeWidth="1" />
        );
      })}
      <polygon
        points={pts(shape)}
        fill={withAlpha(tokens.color.accent, 0.22)}
        stroke={tokens.color.accent}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {shape.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill={tokens.color.accent} />
      ))}
      {played.map((m, i) => {
        const [x, y] = point(i, n, 1.16);
        const anchor = Math.abs(x - CX) < 20 ? 'middle' : x > CX ? 'start' : 'end';
        return (
          <text
            key={m.map}
            x={x}
            y={y + 5}
            textAnchor={anchor}
            fill={tokens.color.ink2}
            fontSize="14"
            fontWeight="600"
          >
            {getMapDisplayName(m.map)}
          </text>
        );
      })}
    </Box>
  );
}
