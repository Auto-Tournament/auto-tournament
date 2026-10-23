import { Box } from '@mui/material';
import {
  BombIcon,
  CrosshairSimpleIcon,
  FlameIcon,
  SkullIcon,
  WrenchIcon,
  XIcon,
} from '@phosphor-icons/react';

export type EventKind = 'kill' | 'headshot' | 'death' | 'planted' | 'defused' | 'exploded';

/** The bomb's own colours, the same on any side. */
const BOMB: Record<'planted' | 'defused' | 'exploded', string> = {
  planted: '#EF9F27',
  defused: '#85B7EB',
  exploded: '#E24B4A',
};

/**
 * An event on a timeline, drawn as its icon at `at` (a CSS left): a skull for
 * a kill, the skull in a crosshair for a headshot (ringed in `ring`), an X for
 * the player's own death, and the bomb's plant, defuse and explosion. `color`
 * is the skull's. A dark outline keeps it readable on any bar.
 */
export function EventMark({
  at,
  kind,
  color = '#f4edeb',
  ring = color,
  title,
}: {
  at: string;
  kind: EventKind;
  color?: string;
  ring?: string;
  title?: string;
}) {
  const size = kind === 'headshot' ? 22 : 16;
  const icon = (() => {
    switch (kind) {
      case 'headshot':
        return (
          <>
            <CrosshairSimpleIcon
              size={22}
              weight="bold"
              color={ring}
              style={{ gridArea: '1 / 1' }}
            />
            <SkullIcon size={10} weight="fill" color={color} style={{ gridArea: '1 / 1' }} />
          </>
        );
      case 'death':
        return <XIcon size={14} weight="bold" color={color} />;
      case 'planted':
        return <BombIcon size={16} weight="fill" color={BOMB.planted} />;
      case 'defused':
        return <WrenchIcon size={16} weight="fill" color={BOMB.defused} />;
      case 'exploded':
        return <FlameIcon size={16} weight="fill" color={BOMB.exploded} />;
      default:
        return <SkullIcon size={16} weight="fill" color={color} />;
    }
  })();
  return (
    <Box
      title={title}
      sx={{
        position: 'absolute',
        left: at,
        width: size,
        height: size,
        ml: `-${size / 2}px`,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)',
      }}
    >
      {icon}
    </Box>
  );
}
