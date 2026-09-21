/**
 * User-pickable colour themes for the Auto Tournament platform client.
 *
 * Colours are computed by the autotournament.gg website's palette code, so
 * the site and the app match. Each theme only overrides the token keys the
 * platform actually uses; anything the website has that the app doesn't
 * (side colours, medals, warning/info, bloom/bloom2 glows – the platform is
 * flat and has no glow tokens) is left alone and keeps today's value in
 * every theme.
 *
 * Ember is the default theme, and matches the values that were hard-coded in
 * tokens.ts before themes existed – picking it must look exactly like today.
 */

export type ThemeId = 'ember' | 'ultraviolet' | 'mint' | 'aurora' | 'coral';

export const THEME_IDS: ThemeId[] = ['ember', 'ultraviolet', 'mint', 'aurora', 'coral'];

export const DEFAULT_THEME_ID: ThemeId = 'ember';

export const THEME_NAMES: Record<ThemeId, string> = {
  ember: 'Ember',
  ultraviolet: 'Ultraviolet',
  mint: 'Mint',
  aurora: 'Aurora',
  coral: 'Coral',
};

/** The subset of `tokens.color` that themes are allowed to override. */
export interface ThemeColorOverrides {
  paper: string;
  paper2: string;
  paper3: string;
  ink: string;
  ink2: string;
  muted: string;
  rule: string;
  accent: string;
  accent2: string;
  accentInk: string;
  focus: string;
  live: string;
  pick: string;
  ban: string;
  navGlass: string;
  /** Fill for the dark parts of the ram logo (AtIcon). */
  logoInk: string;
}

export const THEME_COLORS: Record<ThemeId, ThemeColorOverrides> = {
  ember: {
    paper: '#100908',
    paper2: '#18110e',
    paper3: '#211815',
    ink: '#f4edeb',
    ink2: '#c4bcb9',
    muted: '#938a87',
    rule: '#322926',
    accent: '#ff6a3d',
    accent2: '#fe8f5b',
    accentInk: '#140e0c',
    focus: '#ff6b33',
    live: '#3fc168',
    pick: '#3fc168',
    ban: '#f2645f',
    navGlass: 'rgba(24, 17, 14, 0.82)',
    logoInk: '#1d1d1f',
  },
  ultraviolet: {
    paper: '#0b0917',
    paper2: '#12101f',
    paper3: '#1a1827',
    ink: '#eeedf6',
    ink2: '#bdbcc8',
    muted: '#8b8a98',
    rule: '#2b2939',
    accent: '#9D7BFF',
    accent2: '#C4B1FF',
    accentInk: '#070512',
    focus: '#9D7BFF',
    live: '#3fc168',
    pick: '#3fc168',
    ban: '#f2645f',
    navGlass: 'rgba(18, 16, 31, 0.82)',
    logoInk: '#151423',
  },
  mint: {
    paper: '#000f0b',
    paper2: '#001813',
    paper3: '#04201b',
    ink: '#e6f1ee',
    ink2: '#b3c1be',
    muted: '#80908c',
    rule: '#16312b',
    accent: '#2DCE89',
    accent2: '#20B2AA',
    accentInk: '#000a07',
    focus: '#2DCE89',
    live: '#3fc168',
    pick: '#3fc168',
    ban: '#f2645f',
    navGlass: 'rgba(0, 24, 19, 0.82)',
    logoInk: '#051a16',
  },
  aurora: {
    paper: '#0b0915',
    paper2: '#12111d',
    paper3: '#1a1926',
    ink: '#eeedf6',
    ink2: '#bdbcc8',
    muted: '#8b8a98',
    rule: '#2a2937',
    accent: '#5EEAB5',
    accent2: '#9AF5D2',
    accentInk: '#070611',
    focus: '#5EEAB5',
    live: '#3fc168',
    pick: '#3fc168',
    ban: '#f2645f',
    navGlass: 'rgba(18, 17, 29, 0.82)',
    logoInk: '#151421',
  },
  coral: {
    paper: '#0f090d',
    paper2: '#171014',
    paper3: '#1f181c',
    ink: '#f5ebf1',
    ink2: '#c4bac0',
    muted: '#92898f',
    rule: '#30292d',
    accent: '#FF5F7E',
    accent2: '#FF8FA3',
    accentInk: '#0b0609',
    focus: '#FF5F7E',
    live: '#3fc168',
    pick: '#3fc168',
    ban: '#f2645f',
    navGlass: 'rgba(23, 16, 20, 0.82)',
    logoInk: '#1a1418',
  },
};

const THEME_STORAGE_KEY = 'at-theme';

function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as string[]).includes(value);
}

/** Reads the stored theme id, falling back to the default on any failure. */
export function readStoredThemeId(): ThemeId {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && isThemeId(raw)) return raw;
  } catch {
    // localStorage unavailable (SSR, privacy mode, …) – fall back below.
  }
  return DEFAULT_THEME_ID;
}

/** Saves the chosen theme id and reloads, so the static token imports pick it up. */
export function setTheme(id: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Ignore storage failures – the reload will just keep the current theme.
  }
  window.location.reload();
}
