import path from 'path';

/**
 * Where the built client (and everything served under it, including map
 * images) lives on disk: `api/public` when running from source, and
 * `<dist>/../public` in the bundled build -- which is `/app/public` in
 * Docker, since the release stage copies `api/dist` to `/app/dist` and
 * `api/public` to `/app/public` (see `docker/Dockerfile`).
 *
 * Under tsx/ts-node in dev, this module's own `__dirname` is
 * `api/src/config`, two levels below the API root. In the esbuild bundle,
 * every module is flattened into a single `dist/index.js`, so `__dirname`
 * is `dist/` itself -- only one level below the API root. The `.ts` check
 * below is the same trick `integrations/cs2/maps/routes.ts` used before this
 * module existed: it compensates for that difference so both environments
 * resolve to the same place.
 *
 * `PUBLIC_DIR` and `MAP_IMAGES_DIR` are computed once, here, and imported by
 * both the static-file setup (api entry, `index.ts`) and the map upload
 * route (`integrations/cs2/maps/routes.ts`) so the two can never drift apart
 * again the way they did before -- see PR #284's "Judgement calls" section
 * for how they drifted.
 */
const upToApiRoot = __filename.endsWith('.ts') ? ['..', '..'] : ['..'];

export const PUBLIC_DIR = path.join(__dirname, ...upToApiRoot, 'public');
export const MAP_IMAGES_DIR = path.join(PUBLIC_DIR, 'map-images');

/**
 * Where uploaded map images landed under the bug fixed alongside this
 * module: one directory above `PUBLIC_DIR` instead of inside it. Only
 * relevant to the bundled build/Docker -- in dev the old code already
 * resolved to `MAP_IMAGES_DIR`, so this points at a directory that never
 * existed there.
 *
 * Used solely by `integrations/cs2/maps/migrateLegacyImages.ts` to move any
 * images left behind by existing installs into `MAP_IMAGES_DIR` once, on
 * startup.
 */
export const LEGACY_MAP_IMAGES_DIR = path.join(PUBLIC_DIR, '..', '..', 'public', 'map-images');
