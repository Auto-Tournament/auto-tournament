// The part of pngjs (pure JS, bundled by esbuild) the game icon cache uses.
declare module 'pngjs' {
  export interface PngImage {
    width: number;
    height: number;
    /** RGBA, 8 bits a channel, row by row. */
    data: Buffer;
  }

  export const PNG: {
    new (options: { width: number; height: number }): PngImage;
    sync: {
      read(buffer: Buffer): PngImage;
      write(png: PngImage, options?: { colorType?: number; deflateLevel?: number }): Buffer;
    };
  };
}
