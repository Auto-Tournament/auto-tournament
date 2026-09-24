/** The product name every browser tab ends with. */
export const SITE_TITLE = 'Auto Tournament';

/**
 * A browser tab title in the 3.0 drafts' pattern, "Page · Auto Tournament".
 * With no page name (still loading, nothing found) it is just the site name.
 *
 * Pages set it themselves: `document.title = pageTitle(t('…'))`.
 */
export function pageTitle(page?: string | null): string {
  const name = page?.trim();
  if (!name || name === SITE_TITLE) return SITE_TITLE;
  return `${name} · ${SITE_TITLE}`;
}
