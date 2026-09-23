/**
 * SVGO settings for the module tiles in `client/public/games` (and the
 * masters in the brand repo).
 *
 * Run it with:
 *
 *     npx svgo@3 --multipass -c scripts/svgo-module-icons.config.mjs \
 *       -f client/public/games -o client/public/games
 *
 * The tiles are 2048x2048 Figma exports of a few hundred flat facets each,
 * so the default preset roughly halves them. Two of its plugins have to go:
 *
 * - `removeViewBox` drops `viewBox` when it matches `width`/`height`, which
 *   is fine for an `<img>` and wrong for ours: the tiles are inlined and
 *   sized by CSS (`ModuleIcon`), and an SVG with no viewBox does not scale,
 *   it crops.
 * - `convertColors` would fold the `var(--at-…, #hex)` fills into plain
 *   hex, which is the whole theming mechanism. It leaves `var()` alone in
 *   practice, but the tiles are not worth the risk of a future default.
 *
 * Everything else is the preset, at one decimal of coordinate precision —
 * 0.05px on a 2048px artboard, well under a device pixel at any size the
 * app draws a tile.
 */
export default {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          convertColors: false,
          cleanupNumericValues: { floatPrecision: 1 },
          convertPathData: { floatPrecision: 1 },
          convertTransform: { floatPrecision: 1 },
        },
      },
    },
  ],
};
