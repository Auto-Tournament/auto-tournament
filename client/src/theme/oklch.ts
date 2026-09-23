/**
 * sRGB hex <-> OKLCH, for the one place the app has to compute a colour
 * rather than read one: re-hueing the module tiles' palette for the active
 * theme (`theme/moduleIcons.ts`).
 *
 * OKLCH is the space the token comments are already written in
 * (`accent: oklch(70% 0.19 38)`), and the one where "same lightness, other
 * hue" means what it looks like it means — the thing HSL gets wrong, where a
 * yellow and a blue at the same `L` are nowhere near as bright as each other.
 *
 * Nothing here is a general colour library: it takes six-digit hex in and
 * gives six-digit hex back, which is all the token pipeline deals in.
 *
 * The matrices are Björn Ottosson's OKLab, and the gamut fit is the blunt
 * one — hold lightness and hue, walk chroma down until the colour is inside
 * sRGB. A derived highlight at 95% lightness can ask for more chroma than
 * sRGB has; clipping the channels instead would swing its hue.
 */

export interface Oklch {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma, 0 (grey) upwards; sRGB tops out near 0.37. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function parseHex(hex: string): [number, number, number] {
  const body = hex.replace('#', '');
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function formatHex(rgb: [number, number, number]): string {
  const channel = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/** OKLCH for a `#rgb` or `#rrggbb` colour. */
export function toOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: lightness, c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

/** Linear-light sRGB for an OKLCH colour; channels may fall outside 0..1. */
function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

const EPSILON = 1 / 512; // half a step of 8-bit sRGB, so rounding cannot bite
const inGamut = (rgb: number[]): boolean => rgb.every((v) => v >= -EPSILON && v <= 1 + EPSILON);

/**
 * The nearest sRGB hex to an OKLCH colour, keeping its lightness and hue and
 * giving up chroma if it has to. Sixteen halvings land well inside a rounding
 * step of the chroma sRGB actually has.
 */
export function oklchToHex(colour: Oklch): string {
  let rgb = toLinearRgb(colour);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = colour.c;
    for (let i = 0; i < 16; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut(toLinearRgb({ ...colour, c: mid }))) low = mid;
      else high = mid;
    }
    rgb = toLinearRgb({ ...colour, c: low });
  }
  return formatHex(rgb.map(toGamma) as [number, number, number]);
}
