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
export const tokens = {
  color: {
    paper: '#100908', // oklch(15% 0.012 38)
    paper2: '#18110e', // oklch(18.5% 0.014 38)
    paper3: '#211815', // oklch(22% 0.016 38)
    ink: '#f4edeb', // oklch(95% 0.008 38)
    ink2: '#c4bcb9', // oklch(80% 0.010 38)
    muted: '#938a87', // oklch(64% 0.012 38)
    rule: '#322926', // oklch(29% 0.014 38)
    accent: '#ff6a3d', // brand orange, oklch(70% 0.19 38)
    accent2: '#fe8f5b', // oklch(76% 0.15 45), hover
    accentInk: '#140e0c', // text on accent
    focus: '#ff6b33',
    live: '#3fc168', // oklch(72% 0.17 150)
    pick: '#3fc168', // same green as live
    ban: '#f2645f', // oklch(67% 0.17 25)
    bloom: 'rgba(255, 106, 61, 0.22)',
    bloom2: 'rgba(230, 70, 50, 0.14)',
    // App only: states the website never shows.
    warning: '#f2b84b', // amber, kept apart from the brand orange
    info: '#7fb0e8',
    navGlass: 'rgba(24, 17, 14, 0.82)', // paper2 at 82%, under a backdrop blur
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
    discord: '#5865f2',
    discordHover: '#4752c4',
    github: '#24292e',
    githubHover: '#1b1f23',
    keycloak: '#3262a8',
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
