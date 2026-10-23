import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Box } from '@mui/material';
import {
  BombIcon,
  CrosshairSimpleIcon,
  FlameIcon,
  SkullIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
import { mono, radii, textSize, tokens, withAlpha } from '../../../module-sdk';

const { color } = tokens;

export interface TimelineRound {
  number: number;
  startTick: number;
  endTick: number;
  winner: string | null; // 'CT' | 'T'
}

export interface TimelineMark {
  tick: number;
  kind: 'kill' | 'planted' | 'defused' | 'exploded';
  /** The killer's side for a kill (2 T, 3 CT). */
  side?: number | null;
  headshot?: boolean;
  label: string;
}

/** The round a tick is in: a round owns its last tick (the kill that ended it), not its first. */
function roundAt(rounds: TimelineRound[], t: number): TimelineRound | undefined {
  return rounds.find((r, i) => (i === 0 ? t >= r.startTick : t > r.startTick) && t <= r.endTick);
}

const SIDE: Record<string, string> = { CT: '#8fc0f2', T: '#eac65a' };
const SIDE_NUM: Record<number, string> = { 2: '#eac65a', 3: '#8fc0f2' };
const BOMB: Record<string, string> = {
  planted: '#EF9F27',
  defused: '#85B7EB',
  exploded: '#E24B4A',
};
const BOMB_ICON = { planted: BombIcon, defused: WrenchIcon, exploded: FlameIcon } as const;

/** A mark's icon: the bomb's, or a kill's skull (in a crosshair for a headshot) in the killer's colour. */
function MarkIcon({ m, size }: { m: TimelineMark; size: number }) {
  if (m.kind !== 'kill') {
    const Icon = BOMB_ICON[m.kind];
    return <Icon size={size} weight="fill" color={BOMB[m.kind]} />;
  }
  const c = SIDE_NUM[m.side ?? 0] ?? '#fff';
  if (!m.headshot) return <SkullIcon size={size} weight="fill" color={c} />;
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', width: size, height: size }}>
      <CrosshairSimpleIcon size={size} weight="bold" color={c} style={{ gridArea: '1 / 1' }} />
      <SkullIcon size={size / 2} weight="fill" color={c} style={{ gridArea: '1 / 1' }} />
    </Box>
  );
}

/**
 * The replay's timeline: the whole map as round segments (number on top,
 * the winning side's colour underneath), each kill as a tick in the killer's
 * side colour, the bomb's plant, defuse and explosion as their icons, and
 * the playhead. Click or drag to jump; arrows step 5 s, Page Up/Down a round.
 */
export function ReplayTimeline({
  first,
  last,
  tick,
  tickrate,
  rounds,
  marks,
  label,
  roundLabel,
  onSeek,
}: {
  first: number;
  last: number;
  tick: number;
  tickrate: number;
  rounds: TimelineRound[];
  marks: TimelineMark[];
  label: string;
  /** "Round 3", in the page's language. */
  roundLabel: (n: number) => string;
  onSeek: (tick: number) => void;
}) {
  const ref = useRef<HTMLDivElementLike>(null);
  const [hover, setHover] = useState<{ tick: number; x: number; width: number } | null>(null);
  const span = Math.max(1, last - first);
  const pct = (t: number) => `${((Math.min(last, Math.max(first, t)) - first) / span) * 100}%`;

  const seekAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    onSeek(first + f * span);
  };
  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekAt(e.clientX);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons & 1) seekAt(e.clientX);
    const box = ref.current?.getBoundingClientRect();
    if (box && e.pointerType === 'mouse') {
      const x = Math.min(box.width, Math.max(0, e.clientX - box.left));
      setHover({ tick: first + (x / box.width) * span, x, width: box.width });
    }
  };
  const current = roundAt(rounds, tick);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = 5 * tickrate;
    const idx = current ? rounds.indexOf(current) : -1;
    const go: Record<string, number | undefined> = {
      ArrowRight: tick + step,
      ArrowLeft: tick - step,
      Home: first,
      End: last,
      PageDown: rounds[idx + 1]?.startTick,
      PageUp:
        idx > 0
          ? tick - (current?.startTick ?? 0) > 2 * tickrate
            ? current?.startTick
            : rounds[idx - 1]?.startTick
          : first,
    };
    const to = go[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onSeek(Math.min(last, Math.max(first, to)));
  };

  // The hover card: the round and time under the cursor, and the kills and
  // bomb events within a few pixels of it.
  const near = hover
    ? marks.filter((m) => Math.abs(((m.tick - first) / span) * hover.width - hover.x) <= 6)
    : [];
  const hoverRound = hover ? roundAt(rounds, hover.tick) : undefined;
  const clock = (t: number) => {
    const s = Math.max(0, Math.round(t / tickrate));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <Box sx={{ position: 'relative', mt: 1.5 }}>
      {hover && (hoverRound || near.length > 0) && (
        <Box
          role="tooltip"
          data-testid="replay-timeline-preview"
          sx={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: Math.min(Math.max(hover.x - 110, 0), Math.max(0, hover.width - 220)),
            width: 220,
            zIndex: 2,
            p: 1,
            borderRadius: radii.md,
            bgcolor: 'rgba(11, 13, 16, 0.92)',
            color: '#fff',
            fontSize: textSize.xs,
            pointerEvents: 'none',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {hoverRound && (
            <Box
              sx={{
                fontFamily: mono.fontFamily,
                color: 'rgba(255,255,255,0.7)',
                mb: near.length ? 0.5 : 0,
              }}
            >
              {roundLabel(hoverRound.number)} · {clock(hover.tick - hoverRound.startTick)}
            </Box>
          )}
          {near.slice(0, 6).map((m, i) => (
            <Box
              key={`${m.tick}-${i}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25 }}
            >
              <Box aria-hidden sx={{ flex: 'none', display: 'flex' }}>
                <MarkIcon m={m} size={14} />
              </Box>
              <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.label}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <Box
        ref={ref}
        onPointerLeave={() => setHover(null)}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={first}
        aria-valuemax={last}
        aria-valuenow={Math.round(tick)}
        aria-valuetext={current ? `${current.number}` : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        data-testid="replay-timeline"
        sx={{
          position: 'relative',
          height: 58,
          borderRadius: radii.md,
          bgcolor: color.paper3,
          overflow: 'hidden',
          cursor: 'pointer',
          touchAction: 'none',
          userSelect: 'none',
          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
        }}
      >
        {/* Rounds: alternating shades, the number, and who won underneath. */}
        {rounds.map((r, i) => (
          <Box
            key={r.number}
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: pct(r.startTick),
              width: `calc(${pct(r.endTick)} - ${pct(r.startTick)})`,
              bgcolor: i % 2 ? withAlpha(color.ink, 0.03) : 'transparent',
              borderLeft: i ? `1px solid ${withAlpha(color.ink, 0.08)}` : 'none',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: 4,
                left: 4,
                fontFamily: mono.fontFamily,
                fontSize: '0.65rem',
                color: current?.number === r.number ? color.ink : color.muted,
                fontWeight: current?.number === r.number ? 700 : 400,
              }}
            >
              {r.number}
            </Box>
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 4,
                bgcolor: r.winner ? SIDE[r.winner] : 'transparent',
                opacity: 0.85,
              }}
            />
          </Box>
        ))}

        {/* Kills: a tick in the killer's colour; headshots taller. */}
        {marks
          .filter((m) => m.kind === 'kill')
          .map((m, i) => (
            <Box
              key={`k${m.tick}-${i}`}
              title={m.label}
              sx={{
                position: 'absolute',
                left: pct(m.tick),
                bottom: 8,
                width: 2,
                height: m.headshot ? 22 : 15,
                ml: '-1px',
                borderRadius: 1,
                bgcolor: SIDE_NUM[m.side ?? 0] ?? color.ink2,
                pointerEvents: 'none',
              }}
            />
          ))}

        {/* The bomb: a few a round, so each gets its icon. */}
        {marks
          .filter((m) => m.kind !== 'kill')
          .map((m, i) => (
            <Box
              key={`b${m.tick}-${i}`}
              title={m.label}
              sx={{
                position: 'absolute',
                left: pct(m.tick),
                top: 16,
                ml: '-7px',
                display: 'flex',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 0 1px #000)',
              }}
            >
              <MarkIcon m={m} size={14} />
            </Box>
          ))}

        {/* The playhead. */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: pct(tick),
            width: 2,
            ml: '-1px',
            bgcolor: color.accent,
            boxShadow: `0 0 0 1px ${withAlpha('#000', 0.4)}`,
            pointerEvents: 'none',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: -1,
              left: -5,
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: color.accent,
            },
          }}
        />
      </Box>
    </Box>
  );
}

/** What the timeline needs of its element (the DOM type, without eslint's browser globals). */
type HTMLDivElementLike = { getBoundingClientRect: () => { left: number; width: number } } & object;
