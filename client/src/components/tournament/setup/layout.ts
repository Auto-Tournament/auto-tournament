import { RAIL_ROW_MAX_WIDTH } from '../../../constants/adminLayout';

/**
 * Breakpoints for the setup layout: the Manage rail (248px) and the step
 * list sit beside the form, so the summary drops below it under 1440px, and
 * the step list turns into a
 * horizontal scroller where the admin rail does (820px), since it sits in
 * the rail's column. MUI's named breakpoints don't sit at these widths.
 */
export const MEDIUM = '@media (max-width: 1439.95px)';
export const NARROW = RAIL_ROW_MAX_WIDTH;

/** Text for screen readers only. */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
