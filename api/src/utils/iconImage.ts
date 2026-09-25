/**
 * Turning a downloaded app icon into the small square PNG a game pill draws.
 *
 * Steam ships a game's client icon as a Windows `.ico`: several frames of one
 * picture (16 px up to 256 or 512 px), each either an embedded PNG or a
 * bottom-up BMP. This picks the largest square frame, decodes it to RGBA,
 * scales it down to `GAME_ICON_SIZE` by area averaging (never up), and writes
 * a PNG.
 *
 * Pure JavaScript on purpose: the release image has no `node_modules` (the
 * backend is one esbuild bundle), so a native image library such as sharp
 * cannot come along. pngjs is bundled like any other dependency. The cache
 * therefore stores PNG, not WebP — there is no pure-JS WebP encoder worth
 * shipping, and a 128 px PNG icon is a few KB either way.
 */

import { PNG } from 'pngjs';

/** The size every cached game icon is stored at. */
export const GAME_ICON_SIZE = 128;
/**
 * A frame smaller than this is not used: scaled up it is a blur, and a clean
 * monogram reads better than a smudge.
 */
export const MIN_GAME_ICON_SOURCE_PX = 48;
/** Refuse a picture claiming more pixels than this before decoding it. */
const MAX_SOURCE_PX = 1024;

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 8 bits a channel, row by row, top row first. */
  data: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(bytes: Buffer, offset = 0): boolean {
  return (
    bytes.length >= offset + PNG_SIGNATURE.length &&
    bytes.subarray(offset, offset + PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

/** A PNG's dimensions from its IHDR, without decoding it. */
function pngSize(bytes: Buffer, offset = 0): { width: number; height: number } | null {
  if (!isPng(bytes, offset) || bytes.length < offset + 24) return null;
  return { width: bytes.readUInt32BE(offset + 16), height: bytes.readUInt32BE(offset + 20) };
}

function decodePng(bytes: Buffer): RgbaImage | null {
  const size = pngSize(bytes);
  if (!size || size.width > MAX_SOURCE_PX || size.height > MAX_SOURCE_PX) return null;
  try {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: Buffer.from(png.data) };
  } catch {
    return null;
  }
}

export interface IcoFrame {
  /** Real size in pixels (the directory's 0 means 256; a PNG frame says its own). */
  width: number;
  height: number;
  offset: number;
  length: number;
  png: boolean;
}

/**
 * The frames an `.ico` holds, or null when the bytes are not an icon file.
 * Frames that point outside the file are dropped.
 */
export function icoFrames(bytes: Buffer): IcoFrame[] | null {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (count === 0 || bytes.length < 6 + count * 16) return null;
  const frames: IcoFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (length < 8 || offset + length > bytes.length) continue;
    const png = isPng(bytes, offset);
    const declared = pngSize(bytes, offset);
    frames.push({
      width: png && declared ? declared.width : bytes[entry] || 256,
      height: png && declared ? declared.height : bytes[entry + 1] || 256,
      offset,
      length,
      png,
    });
  }
  return frames;
}

/**
 * A BMP frame of an `.ico`: a BITMAPINFOHEADER, bottom-up pixel rows, then a
 * 1-bit AND mask. 32-bit frames carry their own alpha; 24-bit ones take it
 * from the mask. Other depths (palettes) are not worth decoding for an icon
 * whose large frames are never paletted.
 */
function decodeBmpFrame(bytes: Buffer): RgbaImage | null {
  if (bytes.length < 40) return null;
  const headerSize = bytes.readUInt32LE(0);
  const width = bytes.readInt32LE(4);
  // The height covers the colour rows and the mask rows together.
  const height = Math.abs(bytes.readInt32LE(8)) / 2;
  const bitCount = bytes.readUInt16LE(14);
  const compression = bytes.readUInt32LE(16);
  if (
    headerSize < 40 ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0 ||
    width > MAX_SOURCE_PX ||
    height > MAX_SOURCE_PX ||
    compression !== 0 ||
    (bitCount !== 32 && bitCount !== 24)
  ) {
    return null;
  }

  const bytesPerPixel = bitCount / 8;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const maskRowSize = Math.ceil(width / 32) * 4;
  const pixelStart = headerSize;
  const maskStart = pixelStart + rowSize * height;
  const hasMask = bytes.length >= maskStart + maskRowSize * height;
  if (bytes.length < maskStart) return null;

  const data = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const sourceRow = pixelStart + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      data[target] = bytes[source + 2];
      data[target + 1] = bytes[source + 1];
      data[target + 2] = bytes[source];
      const alpha = bitCount === 32 ? bytes[source + 3] : 255;
      data[target + 3] = alpha;
      if (bitCount === 32 && alpha !== 0) anyAlpha = true;
    }
  }

  // A 24-bit frame, or a 32-bit one whose alpha is all zero (an old-style
  // icon), is cut out by its AND mask: a set bit is transparent.
  if (hasMask && (bitCount === 24 || !anyAlpha)) {
    for (let y = 0; y < height; y += 1) {
      const maskRow = maskStart + (height - 1 - y) * maskRowSize;
      for (let x = 0; x < width; x += 1) {
        const transparent = (bytes[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1;
        data[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { width, height, data };
}

/** The largest square frame of an `.ico`, decoded, or null when none decodes. */
export function decodeLargestIcoFrame(bytes: Buffer): RgbaImage | null {
  const frames = icoFrames(bytes);
  if (!frames) return null;
  const square = frames
    .filter((frame) => frame.width === frame.height)
    // Largest first; at one size a PNG frame first, it is the better-kept one.
    .sort((a, b) => b.width - a.width || Number(b.png) - Number(a.png));
  for (const frame of square) {
    const slice = bytes.subarray(frame.offset, frame.offset + frame.length);
    const image = frame.png ? decodePng(slice) : decodeBmpFrame(slice);
    if (image && image.width === image.height) return image;
  }
  return null;
}

/**
 * Scale a square image down to `size` by area averaging, in premultiplied
 * alpha so transparent pixels do not darken the edges. Never scales up: a
 * source at or under `size` is returned as it is.
 */
export function scaleDown(image: RgbaImage, size: number): RgbaImage {
  if (image.width <= size && image.height <= size) return image;
  const out = Buffer.alloc(size * size * 4);
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let y = 0; y < size; y += 1) {
    const top = y * scaleY;
    const bottom = top + scaleY;
    for (let x = 0; x < size; x += 1) {
      const left = x * scaleX;
      const right = left + scaleX;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let weight = 0;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy += 1) {
        const wy = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx += 1) {
          const w = wy * (Math.min(right, sx + 1) - Math.max(left, sx));
          const i = (sy * image.width + sx) * 4;
          const a = image.data[i + 3];
          red += image.data[i] * a * w;
          green += image.data[i + 1] * a * w;
          blue += image.data[i + 2] * a * w;
          alpha += a * w;
          weight += w;
        }
      }
      const target = (y * size + x) * 4;
      if (alpha > 0) {
        out[target] = Math.round(red / alpha);
        out[target + 1] = Math.round(green / alpha);
        out[target + 2] = Math.round(blue / alpha);
      }
      out[target + 3] = Math.round(alpha / weight);
    }
  }
  return { width: size, height: size, data: out };
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

/**
 * A downloaded icon (`.ico`, or a PNG) as the game pill's square PNG, or null
 * when it is not one: unreadable, not square, or too small to be worth more
 * than a monogram.
 */
export function toGameIconPng(bytes: Buffer): Buffer | null {
  const image = isPng(bytes) ? decodePng(bytes) : decodeLargestIcoFrame(bytes);
  if (!image || image.width !== image.height || image.width < MIN_GAME_ICON_SOURCE_PX) return null;
  return encodePng(scaleDown(image, GAME_ICON_SIZE));
}
