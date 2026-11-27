import { test, expect } from '@playwright/test';
import {
  crosshairPixels,
  decodeCrosshairCode,
} from '../../client/src/integrations/cs2/profile/crosshairCode';

/**
 * The Config tab's crosshair preview: share codes decoded as csgo-sharecode (AkiVer, MIT) does.
 * The cs2-v1 expectation is that library's documented example.
 */

const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';

/** Bytes -> an old `CSGO-…` code (checksum set), to build legacy cases. */
function legacyCode(bytes: number[]): string {
  bytes[0] = bytes.slice(1).reduce((s, b) => s + b, 0) % 256;
  let total = BigInt('0x' + bytes.map((b) => b.toString(16).padStart(2, '0')).join(''));
  let chars = '';
  for (let i = 0; i < 25; i++) {
    chars += DICTIONARY[Number(total % BigInt(57))];
    total = total / BigInt(57);
  }
  return `CSGO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20, 25)}`;
}

test.describe('crosshair share code', { tag: ['@api'] }, () => {
  test('a CS2 code (cs2-v1): the library documented example', () => {
    const c = decodeCrosshairCode('CSvbPubOq37zTGqtsPTP5QTrp5CB4xFXiKRLfzJsm49ZRe');
    expect(c).toMatchObject({
      format: 'cs2-v1',
      pixels: true,
      style: 2,
      centerDot: true,
      tStyle: false,
      outline: false,
      red: 255,
      green: 0,
      blue: 0,
      alpha: 255,
      gap: 0,
      length: 5,
      thickness: 1,
      screenHeight: 768,
    });
    // At 1080p: 5 px at 768 high is 7 px.
    expect(crosshairPixels(c!)).toEqual({ length: 7, thickness: 1, gap: 0, outline: 0 });
  });

  test('an old CS:GO code (legacy-v1): gap -3, size 2, thickness 0.5, outline 1, green, no dot', () => {
    const b = new Array(18).fill(0);
    b[1] = 1;
    b[2] = (-30 + 256) & 0xff; // gap -3.0
    b[3] = 2; // outline 1
    b[4] = 50;
    b[5] = 250;
    b[6] = 50;
    b[7] = 200;
    b[10] = 1 | 8; // colour 1, outline on
    b[12] = 5; // thickness 0.5
    b[13] = 4 << 1; // style 4, no dot, alpha off
    b[14] = 20; // size 2.0
    const c = decodeCrosshairCode(legacyCode(b));
    expect(c).toMatchObject({
      format: 'legacy-v1',
      pixels: false,
      gap: -3,
      length: 2,
      thickness: 0.5,
      outline: true,
      outlineThickness: 1,
      style: 4,
      centerDot: false,
      red: 50,
      green: 250,
      blue: 50,
      alpha: 255, // alpha off: drawn opaque
    });
    expect(crosshairPixels(c!)).toEqual({ length: 5, thickness: 1, gap: 0, outline: 1 });
  });

  test('not a code, a bad checksum, an unknown version: null', () => {
    expect(decodeCrosshairCode('')).toBeNull();
    expect(decodeCrosshairCode('CSGO-short')).toBeNull();
    expect(decodeCrosshairCode('CSvbPubOq37zTGqtsPTP5QTrp5CB4xFXiKRLfzJsm49ZRf')).toBeNull();
    const b = new Array(18).fill(0);
    b[1] = 2; // legacy-v2 was never released
    expect(decodeCrosshairCode(legacyCode(b))).toBeNull();
  });
});
