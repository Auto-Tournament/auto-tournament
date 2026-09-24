/**
 * The floating top bar (the 3.0 drafts' `.nav`, `drafts/platform/app.css`):
 * a pill that sticks 12px below the window's top edge, in the same 1200px
 * wrap as the page.
 */

/** Gap between the window's top edge (or the impersonation banner) and the bar. */
export const NAV_GAP_PX = 12;

/** The bar's height: a 32px avatar plus 8px of padding and the border. */
export const NAV_HEIGHT_PX = 50;

/** Height of the impersonation banner, 0px when it is not shown. */
const BANNER_HEIGHT = 'var(--mat-impersonation-height, 0px)';

/** `top` of the sticky bar: below the impersonation banner when it shows. */
export const NAV_STICKY_TOP = `calc(${BANNER_HEIGHT} + ${NAV_GAP_PX}px)`;

/** `top` for something sticky under the bar (the admin rail), a gap below it. */
export const BELOW_NAV_STICKY_TOP = `calc(${BANNER_HEIGHT} + ${2 * NAV_GAP_PX + NAV_HEIGHT_PX}px)`;
