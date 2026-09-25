import { BELOW_NAV_STICKY_TOP } from './navBar';

/**
 * The admin shell's one layout breakpoint, the same 820px the 3.0 designs
 * (`drafts/platform/manage.html`) and #268 use. Above it the admin rail is a
 * column beside the page; at or below it, a horizontal scroller above it.
 */
export const RAIL_COLUMN_MIN_WIDTH = '@media (min-width: 820.1px)';

/** At or below the breakpoint: the left column is a row above the page. */
export const RAIL_ROW_MAX_WIDTH = '@media (max-width: 820px)';

/** Width of the shell's left column above the breakpoint. */
export const RAIL_COLUMN_WIDTH = 220;

/**
 * The shell's left column, whoever fills it (the Manage rail, or the setup
 * wizard's steps): full width above the page on a phone, a sticky 220px
 * column beside it above 820px.
 */
export const railColumnSx = {
  position: 'static',
  width: '100%',
  minWidth: 0,
  flex: '0 0 auto',
  displayPrint: 'none',
  [RAIL_COLUMN_MIN_WIDTH]: {
    position: 'sticky',
    top: BELOW_NAV_STICKY_TOP,
    alignSelf: 'flex-start',
    width: RAIL_COLUMN_WIDTH,
    flex: `0 0 ${RAIL_COLUMN_WIDTH}px`,
  },
} as const;
