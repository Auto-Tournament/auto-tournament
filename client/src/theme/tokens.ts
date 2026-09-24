/**
 * Auto Tournament design tokens.
 *
 * Copied from the autotournament.gg website (src/theme/tokens.ts), which is the
 * source of truth. Keep the shared values in step with it when a colour
 * changes. Values only the app needs (warning, info, overlays) are marked.
 *
 * Components should not hard-code colours: read them from here or from the
 * MUI theme (theme/index.ts), which is built from these tokens.
 */
import { DEFAULT_THEME_ID, THEME_COLORS, readStoredThemeId, type ThemeId } from './themes';

// Read the chosen theme synchronously, before the MUI theme below is built,
// and merge its overrides over the Ember defaults. See theme/themes.ts.
export const activeThemeId: ThemeId = typeof window === 'undefined' ? DEFAULT_THEME_ID : readStoredThemeId();
export { setTheme } from './themes';

const activeThemeColors = THEME_COLORS[activeThemeId];

export const tokens = {
  color: {
    paper: activeThemeColors.paper, // oklch(15% 0.012 38)
    paper2: activeThemeColors.paper2, // oklch(18.5% 0.014 38)
    paper3: activeThemeColors.paper3, // oklch(22% 0.016 38)
    ink: activeThemeColors.ink, // oklch(95% 0.008 38)
    ink2: activeThemeColors.ink2, // oklch(80% 0.010 38)
    muted: activeThemeColors.muted, // oklch(64% 0.012 38)
    rule: activeThemeColors.rule, // oklch(29% 0.014 38)
    accent: activeThemeColors.accent, // brand orange, oklch(70% 0.19 38)
    accent2: activeThemeColors.accent2, // oklch(76% 0.15 45), hover
    accentInk: activeThemeColors.accentInk, // text on accent
    focus: activeThemeColors.focus,
    live: activeThemeColors.live, // oklch(72% 0.17 150)
    pick: activeThemeColors.pick, // same green as live
    ban: activeThemeColors.ban, // oklch(67% 0.17 25)
    // Fill for the dark parts of the ram logo (AtIcon).
    logoInk: activeThemeColors.logoInk,
    // App only: states the website never shows.
    warning: '#f2b84b', // amber, kept apart from the brand orange
    info: '#7fb0e8',
    navGlass: activeThemeColors.navGlass, // paper2 at 82%, under a backdrop blur
    scrim: 'rgba(8, 4, 3, 0.72)', // dialog backdrop
    shadow: 'rgba(0, 0, 0, 0.45)',
    // CS2 side colours, used on scoreboards and side picks.
    sideCt: '#7fb0e8',
    sideT: '#e8b04b',
    // Leaderboard medals for places 1-3.
    medalGold: '#f2c14b',
    medalSilver: '#c4bcb9',
    medalBronze: '#c98a5a',
  },
  /** Third-party sign-in button colours (their brand guidelines, not ours). */
  brand: {
    steam: '#171a21',
    steamHover: '#1b2838',
    keycloakHover: '#274c82',
    onBrand: '#ffffff',
  },
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
  space: { xs: '0.5rem', sm: '0.75rem', md: '1rem', lg: '1.5rem', xl: '2rem', '2xl': '3rem', '3xl': '5rem', '4xl': '8rem' },
  ease: {
    out: 'cubic-bezier(0.22, 1, 0.36, 1)',
    in: 'cubic-bezier(0.55, 0, 1, 0.45)',
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  },
  duration: { fast: 150, base: 240, slow: 600 },
} as const;

/**
 * The radius tokens as CSS lengths, ready for `sx`. A bare number in
 * `sx.borderRadius` is multiplied by the theme's 8px unit (`2` is 16px, not a
 * token), so surfaces use these instead: `lg` for panels and cards, `md` for
 * tiles and inset boxes, `sm` for small marks and chips, `pill` for pills.
 */
export const radii = {
  sm: `${tokens.radius.sm}px`,
  md: `${tokens.radius.md}px`,
  lg: `${tokens.radius.lg}px`,
  pill: `${tokens.radius.pill}px`,
} as const;

/**
 * The draft's type sizes (`tokens.css` `--text-*`) that the MUI variants do
 * not already carry. `3xl` is the page title (`PageHead`), `xl` the section
 * title (`SectionHead`, MUI `h5`).
 */
export const textSize = {
  xs: '0.75rem',
  sm: '0.8125rem',
  md: '0.9375rem',
  lg: '1.125rem',
  xl: '1.375rem',
  '2xl': 'clamp(1.6rem, 1.2vw + 1.2rem, 2.1rem)',
  '3xl': 'clamp(2rem, 2.4vw + 1.2rem, 3rem)',
} as const;

/**
 * Tints for a game's monogram tile (`GameMark`) when it has no cover image.
 * Picked by hashing the game's catalog slug, so the same game always lands on
 * the same tint — but the colours themselves are theme tokens, never hex
 * written into the component.
 */
export const gameTintPalette: readonly string[] = [
  tokens.color.accent,
  tokens.color.info,
  tokens.color.live,
  tokens.color.warning,
  tokens.color.sideCt,
  tokens.color.sideT,
];

export const fontDisplay = '"Sora", "Geist", system-ui, sans-serif';
export const fontBody = '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
export const fontMono = '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

/** Spread into `sx` for numbers, IDs and labels set in the mono face. */
export const mono = { fontFamily: fontMono } as const;

/**
 * `rgba()` from a token hex, for tints (e.g. a 12% orange wash). Keeps tinted
 * colours tied to the token instead of a second hard-coded value.
 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
