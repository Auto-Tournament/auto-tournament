/**
 * The palette the module tiles (`client/public/games/*.svg`) are painted in,
 * re-hued for the active theme.
 *
 * Every tile writes its fills as `fill="var(--at-ember, #ff6a3d)"` — the
 * variable first, the Ember hex as a fallback so the file still looks right
 * opened on its own. The variables are the whole theming mechanism: give the
 * page a different set and the seventeen tiles follow, with nothing in the
 * paths touched. `theme/index.ts` puts these on `:root`; `ModuleIcon` inlines
 * the SVG so they can reach it (an `<img>` is a separate document and page
 * CSS never gets in — which is why the tiles were orange in every theme).
 *
 * The tiles are drawn in seven warm steps and a ten-step grey ramp. The greys
 * stay grey in every theme: they are the artwork's own shading, and tinting
 * them turns a photo-real barrel or a chess piece into a colour wash. Only
 * the warm steps move.
 *
 * ## How the warm ramp is re-hued
 *
 * `--at-ember` is the theme's `accent`, exactly, and `--at-ember-light` is
 * its `accent2`. The other five keep the Ember ramp's *relative* lightness
 * rather than its absolute lightness, because the themes' accents are not
 * all as light as the brand orange: Aurora's is `oklch(85%)` against Ember's
 * `oklch(70%)`, and shifting the ramp up by that much would push the two
 * highlight steps past white. So each step's distance from the accent is
 * expressed as a fraction of the room there is — upwards, of the distance to
 * white; downwards, of the distance to black — and that fraction is applied
 * to the theme's own accent. Ember maps back onto itself to the byte.
 *
 * Chroma scales by the same ratio the Ember step had to its anchor, so a
 * highlight stays as much paler as it was, and hue comes from `accent` for
 * the shadow steps and `accent2` for the highlights (which is where a theme's
 * own warm-or-cool drift lives).
 *
 * One clamp: a highlight has to be lighter than what it highlights. Mint's
 * `accent2` is a teal *darker* than its green `accent`, and used raw it would
 * turn every lit facet into a shadow, so `--at-ember-light` takes the higher
 * of `accent2`'s lightness and the ramp's own. For the other four themes
 * `accent2` wins and the step is `accent2` exactly.
 */
import { oklchToHex, toOklch, type Oklch } from './oklch';
import { tokens } from './tokens';

/** The warm ramp as the tiles were drawn, and their `var()` fallbacks. */
const EMBER_RAMP = {
  '--at-ember': '#ff6a3d',
  '--at-ember-light': '#ff8f66',
  '--at-ember-pale': '#ffb79b',
  '--at-ember-mist': '#ffd9c9',
  '--at-ember-deep': '#d1512c',
  '--at-ember-dark': '#8f3a20',
  '--at-ember-ink': '#5c2614',
} as const;

type EmberStep = keyof typeof EMBER_RAMP;

/** The highlight steps, hued from `accent2`; the rest hue from `accent`. */
const HIGHLIGHT_STEPS: readonly EmberStep[] = ['--at-ember-light', '--at-ember-pale', '--at-ember-mist'];

/**
 * The greys, unchanged in every theme. They are emitted rather than left to
 * the files' own fallbacks so that the whole palette is declared in one
 * place, and so a theme that ever does want its own greys has somewhere to
 * put them.
 */
const INK_RAMP = {
  '--at-ink-0': '#ffffff',
  '--at-ink-100': '#e8e8e8',
  '--at-ink-200': '#cfcfcf',
  '--at-ink-300': '#b0b0b0',
  '--at-ink-400': '#8d8d8d',
  '--at-ink-500': '#6b6b6b',
  '--at-ink-600': '#4d4d4e',
  '--at-ink-700': '#343435',
  '--at-ink-800': '#222223',
  '--at-ink-900': '#121213',
} as const;

/**
 * Where a step sits between the anchor and the end of the range, and how much
 * of the anchor's chroma it keeps. Computed from `EMBER_RAMP` rather than
 * written down, so the two never drift apart.
 */
interface StepShape {
  /** Fraction of the room above the accent (towards white), or below it. */
  reach: number;
  /** Lighter than the accent? Decides which end of the range `reach` spans. */
  up: boolean;
  /** Chroma as a share of the anchor's. */
  chroma: number;
}

function shapeRamp(): Record<EmberStep, StepShape> {
  const base = toOklch(EMBER_RAMP['--at-ember']);
  const light = toOklch(EMBER_RAMP['--at-ember-light']);
  const shape = {} as Record<EmberStep, StepShape>;

  for (const step of Object.keys(EMBER_RAMP) as EmberStep[]) {
    const ref = toOklch(EMBER_RAMP[step]);
    const anchor = HIGHLIGHT_STEPS.includes(step) ? light : base;
    const up = ref.l >= base.l;
    shape[step] = {
      up,
      reach: up ? (ref.l - base.l) / (1 - base.l) : (base.l - ref.l) / base.l,
      chroma: anchor.c === 0 ? 0 : ref.c / anchor.c,
    };
  }
  return shape;
}

const RAMP_SHAPE = shapeRamp();

/** The active theme's warm ramp, plus the greys, as CSS custom properties. */
export function moduleIconPalette(accentHex: string, accent2Hex: string): Record<string, string> {
  const accent = toOklch(accentHex);
  const accent2 = toOklch(accent2Hex);
  const vars: Record<string, string> = { ...INK_RAMP };

  for (const step of Object.keys(EMBER_RAMP) as EmberStep[]) {
    if (step === '--at-ember') {
      vars[step] = accentHex;
      continue;
    }
    const { up, reach, chroma } = RAMP_SHAPE[step];
    const highlight = HIGHLIGHT_STEPS.includes(step);
    const anchor = highlight ? accent2 : accent;
    const derived: Oklch = {
      l: up ? accent.l + reach * (1 - accent.l) : accent.l - reach * accent.l,
      c: anchor.c * chroma,
      h: anchor.h,
    };
    // `accent2` is the step, when it is in fact lighter than the colour it is
    // highlighting. Mint's is not; see the note at the top of the file.
    if (step === '--at-ember-light' && accent2.l > derived.l) {
      vars[step] = accent2Hex;
      continue;
    }
    vars[step] = oklchToHex(derived);
  }
  return vars;
}

/** The palette for the theme the app booted with. */
export const moduleIconVars = moduleIconPalette(tokens.color.accent, tokens.color.accent2);
