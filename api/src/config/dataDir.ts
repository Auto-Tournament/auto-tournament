import path from 'path';

/**
 * `api/data` when running from source (`api/src/config`), and `<dist>/../../data`
 * in the bundled build, where every module's `__dirname` is `dist/`.
 *
 * Kept in a core module two levels below the API root on purpose: code that
 * lives deeper (e.g. `integrations/cs2/routes`) cannot count `..` from its own
 * `__dirname`, because the bundle flattens it to `dist/` and the count would
 * then differ between source and release builds.
 */
export const DATA_DIR = path.join(__dirname, '..', '..', 'data');
