/**
 * The map roulette in the match room: the pool's maps in a grid, a light
 * snaking over them (left to right, then back on the next row), slowing down
 * until it stops on the map the match was given. The map is decided before
 * this starts; the roll is only how it is shown.
 *
 * Runs once per match per browser tab (sessionStorage), and not at all with
 * "reduce motion": then the chosen map is simply shown.
 */
import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { tokens, radii, fontDisplay } from '../../theme/tokens';

export interface RouletteMap {
  id: string;
  name: string;
  imageUrl: string | null;
}

const COLUMNS = { xs: 3, sm: 4, md: 5 } as const;

/** The grid order a snake visits: row by row, every other row right to left. */
function snakeOrder(count: number, columns: number): number[] {
  const order: number[] = [];
  for (let row = 0; row * columns < count; row++) {
    const cells = [];
    for (let c = 0; c < columns && row * columns + c < count; c++) cells.push(row * columns + c);
    order.push(...(row % 2 === 1 ? cells.reverse() : cells));
  }
  return order;
}

function seenKey(lobbyId: string) {
  return `mm-roulette-${lobbyId}`;
}

export function MapRoulette({ lobbyId, maps, chosen }: { lobbyId: string; maps: RouletteMap[]; chosen: string }) {
  const { t } = useTranslation();
  const target = Math.max(0, maps.findIndex((m) => m.id === chosen));
  const theme = useTheme();
  const md = useMediaQuery(theme.breakpoints.up('md'));
  const sm = useMediaQuery(theme.breakpoints.up('sm'));
  const columns = md ? COLUMNS.md : sm ? COLUMNS.sm : COLUMNS.xs;
  const order = useMemo(() => snakeOrder(maps.length, columns), [maps.length, columns]);
  const [lit, setLit] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let skip = false;
    try {
      skip = sessionStorage.getItem(seenKey(lobbyId)) === '1';
      sessionStorage.setItem(seenKey(lobbyId), '1');
    } catch {
      // No storage: roll every time.
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
      setLit(target);
      setDone(true);
    };
    if (skip || reduce || maps.length < 2) {
      const id = setTimeout(finish, 0);
      return () => clearTimeout(id);
    }
    // Two full laps, then on to the target; each step a little slower.
    const stopAt = order.indexOf(target);
    const steps = order.length * 2 + stopAt;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      at += 45 + 260 * progress ** 3;
      const cell = order[i % order.length];
      timers.push(setTimeout(() => setLit(cell), at));
    }
    timers.push(setTimeout(finish, at + 250));
    return () => timers.forEach(clearTimeout);
  }, [lobbyId, maps.length, order, target]);

  return (
    <Box data-testid="mm-roulette" aria-live="polite">
      <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.25rem', mb: 1.5 }}>
        {done ? t('matchmaking.roulette.picked', { map: maps[target]?.name ?? chosen }) : t('matchmaking.roulette.rolling')}
      </Typography>
      <Box
        sx={{ display: 'grid', gap: 1, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {maps.map((m, i) => {
          const on = lit === i;
          const picked = done && i === target;
          return (
            <Box
              key={m.id}
              data-testid={picked ? 'mm-roulette-picked' : undefined}
              aria-current={picked ? 'true' : undefined}
              sx={{
                position: 'relative',
                aspectRatio: '16 / 9',
                borderRadius: `${radii.sm}px`,
                overflow: 'hidden',
                bgcolor: tokens.color.paper3,
                backgroundImage: m.imageUrl ? `url(${m.imageUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                outline: on ? `3px solid ${tokens.color.accent}` : '3px solid transparent',
                filter: done && !picked ? 'grayscale(1) brightness(0.45)' : on ? 'none' : 'brightness(0.6)',
                transform: picked ? 'scale(1.04)' : 'none',
                transition: 'filter 120ms, transform 300ms',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  left: 6,
                  bottom: 4,
                  right: 6,
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 3px rgba(0,0,0,.8)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.name}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
