import { tokens } from '../../../theme/tokens';

/**
 * Veto history styling shared by the live veto page and the team match page,
 * following the homepage veto card: inset rows on paper3, bans in red and
 * struck through, picks in green.
 */

const { color, radius } = tokens;

type VetoActionKind = 'ban' | 'pick' | 'side_pick' | string;

export const vetoActionColor = (action: VetoActionKind): string =>
  action === 'ban' ? color.ban : action === 'pick' ? color.pick : color.info;

export const vetoHistoryRowSx = (action: VetoActionKind) => ({
  px: 1.5,
  py: 1.25,
  borderRadius: `${radius.sm}px`,
  bgcolor: color.paper3,
  boxShadow: action === 'pick' ? `inset 0 0 0 1px ${color.pick}` : 'none',
});

/** Map name inside a history row: red and struck through when banned. */
export const vetoMapNameSx = (action: VetoActionKind) => ({
  color: action === 'side_pick' ? color.ink : vetoActionColor(action),
  textDecoration: action === 'ban' ? 'line-through' : 'none',
  textDecorationThickness: '2px',
  fontWeight: 600,
});
