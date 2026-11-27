/**
 * Decoding a CS2 crosshair share code, for the Config tab's preview. Pure.
 *
 * Ported from csgo-sharecode 7.0.1 by AkiVer (MIT, https://github.com/akiver/csgo-sharecode):
 * the base-57 container, the checksum and the byte layouts. Two containers:
 * - `CS` + 44 characters (32 bytes): what CS2 produces today (format cs2-v1, pixel values at a
 *   screen height).
 * - `CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx` (18 bytes): the old container, CS2 no longer imports it.
 *   Its legacy-v1 is CS:GO's (values in cvar units); legacy-v3 and v4 are CS2-era pixel formats.
 */

const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const LEGACY_RE = new RegExp(`^CSGO(-?[${DICTIONARY}]{5}){5}$`);
const CS2_RE = new RegExp(`^CS[${DICTIONARY}]{44}$`);

export interface Crosshair {
  format: 'legacy-v1' | 'legacy-v3' | 'legacy-v4' | 'cs2-v1';
  /** true: length, thickness and gap are pixels at `screenHeight`; false: CS:GO cvar units. */
  pixels: boolean;
  screenHeight: number | null;
  style: number;
  centerDot: boolean;
  tStyle: boolean;
  outline: boolean;
  /** Outline thickness: cvar units (legacy-v1) or pixels (1 for the pixel formats). */
  outlineThickness: number;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  gap: number;
  length: number;
  thickness: number;
}

function charsToBytes(chars: string, byteLength: number): number[] {
  const base = BigInt(DICTIONARY.length);
  let big = BigInt(0);
  for (const c of Array.from(chars).reverse()) big = big * base + BigInt(DICTIONARY.indexOf(c));
  const hex = big.toString(16).padStart(byteLength * 2, '0');
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

const int8 = (n: number) => (n << 24) >> 24;
const checksumOk = (bytes: number[]) =>
  bytes[0] === bytes.slice(1).reduce((s, b) => s + b, 0) % 256;

function legacyV1(b: number[]): Crosshair {
  return {
    format: 'legacy-v1',
    pixels: false,
    screenHeight: null,
    gap: int8(b[2]) / 10,
    outlineThickness: b[3] / 2,
    red: b[4],
    green: b[5],
    blue: b[6],
    alpha: (b[13] >> 4) & 4 ? b[7] : 255,
    outline: (b[10] & 8) === 8,
    thickness: b[12] / 10,
    centerDot: ((b[13] >> 4) & 1) === 1,
    tStyle: ((b[13] >> 4) & 8) === 8,
    style: (b[13] & 0xf) >> 1,
    length: b[14] / 10,
  };
}

function legacyPixels(b: number[], format: 'legacy-v3' | 'legacy-v4'): Crosshair {
  const bits = b[10] | (b[11] << 8) | (b[12] << 16) | (b[13] << 24);
  return {
    format,
    pixels: true,
    screenHeight: b[14] | (b[15] << 8),
    style: b[2] & 0xf,
    centerDot: (b[2] & 0x40) === 0x40,
    tStyle: (b[2] & 0x80) === 0x80,
    outline: format === 'legacy-v3' ? (b[2] & 0x20) === 0x20 : ((b[13] >> 4) & 3) > 0,
    outlineThickness: 1,
    red: b[3],
    green: b[4],
    blue: b[5],
    alpha: b[6],
    gap: b[7],
    length: b[8],
    thickness: (bits >> 23) & 0x1f,
  };
}

function cs2V1(b: number[]): Crosshair | null {
  const screenHeight = b[2] | (b[3] << 8);
  if (screenHeight === 0) return null;
  return {
    format: 'cs2-v1',
    pixels: true,
    screenHeight: Math.max(screenHeight, 240),
    style: Math.min(b[4] & 0x1f, 9),
    centerDot: (b[4] & 0x40) === 0x40,
    tStyle: (b[4] & 0x80) === 0x80,
    outline: Math.min(b[13] >>> 6, 2) > 0,
    outlineThickness: 1,
    red: b[5],
    green: b[6],
    blue: b[7],
    alpha: b[8],
    gap: Math.min(Math.max(((b[14] | (b[15] << 8)) << 16) >> 16, -3840), 3840),
    length: b[16],
    thickness: Math.min(b[13] & 0x3f, 32),
  };
}

/** The crosshair in a share code, or null when it is not one (or a format we don't know). */
export function decodeCrosshairCode(code: string | null | undefined): Crosshair | null {
  if (!code) return null;
  if (CS2_RE.test(code)) {
    const bytes = charsToBytes(code.slice(2), 32);
    if (!checksumOk(bytes) || bytes[1] !== 1) return null;
    return cs2V1(bytes);
  }
  if (LEGACY_RE.test(code)) {
    const bytes = charsToBytes(code.replace(/CSGO|-/g, ''), 18);
    if (!checksumOk(bytes)) return null;
    if (bytes[1] === 1) return legacyV1(bytes);
    if (bytes[1] === 3) return legacyPixels(bytes, 'legacy-v3');
    if (bytes[1] === 4) return legacyPixels(bytes, 'legacy-v4');
  }
  return null;
}

/** Pixels on a 1080-high screen: what the preview draws, one CSS pixel per screen pixel. */
export interface CrosshairPixels {
  length: number;
  thickness: number;
  /** From the centre to where each arm starts. */
  gap: number;
  outline: number;
}

export function crosshairPixels(c: Crosshair): CrosshairPixels {
  if (c.pixels) {
    const s = 1080 / (c.screenHeight ?? 1080);
    return {
      length: Math.max(0, Math.round(c.length * s)),
      thickness: Math.max(1, Math.round(c.thickness * s)),
      gap: Math.max(0, Math.round(c.gap * s)),
      outline: c.outline ? Math.max(1, Math.round(c.outlineThickness * s)) : 0,
    };
  }
  // CS:GO units scale with the screen height over 480 (YRES); the arms start 4 units out plus the gap.
  const yres = (v: number) => (v * 1080) / 480;
  return {
    length: Math.max(0, Math.round(yres(c.length))),
    thickness: Math.max(1, Math.round(yres(c.thickness))),
    gap: Math.max(0, Math.round(4 + yres(c.gap))),
    outline: c.outline ? Math.max(1, Math.round(c.outlineThickness)) : 0,
  };
}
