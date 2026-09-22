/**
 * Breakpoints for the setup layout, from the design: the summary drops below
 * the form under 1100px, and the step list turns into a horizontal scroller
 * under 760px. MUI's named breakpoints don't sit at these widths.
 */
export const MEDIUM = '@media (max-width: 1099.95px)';
export const NARROW = '@media (max-width: 759.95px)';

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
