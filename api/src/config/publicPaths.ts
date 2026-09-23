import path from 'path';
import { DATA_DIR } from './dataDir';

/**
 * Where the built client lives on disk: `api/public` when running from
 * source, and `<dist>/../public` in the bundled build -- which is
 * `/app/public` in Docker, since the release stage copies `api/dist` to
 * `/app/dist` and `api/public` to `/app/public` (see `docker/Dockerfile`).
 *
 * Under tsx/ts-node in dev, this module's own `__dirname` is
 * `api/src/config`, two levels below the API root. In the esbuild bundle,
 * every module is flattened into a single `dist/index.js`, so `__dirname`
 * is `dist/` itself -- only one level below the API root. The `.ts` check
 * below is the same trick `integrations/cs2/maps/routes.ts` used before this
 * module existed: it compensates for that difference so both environments
 * resolve to the same place.
 *
 * `PUBLIC_DIR` holds build output only. It is baked into the image and
 * replaced wholesale by every update, so nothing written at runtime may live
 * under it -- see `MAP_IMAGES_DIR`.
 */
const upToApiRoot = __filename.endsWith('.ts') ? ['..', '..'] : ['..'];

export const PUBLIC_DIR = path.join(__dirname, ...upToApiRoot, 'public');

/**
 * Where uploaded map images live: under `DATA_DIR`, the directory
 * `docker/docker-compose.yml` (and `docker-compose.local.yml`) mount the
 * persistent volume on (`./data:/app/data`).
 *
 * They used to live under `PUBLIC_DIR`, which is part of the image rather
 * than the volume, so every container recreate -- i.e. every update -- threw
 * away every image an admin had uploaded. #290 fixed *where* uploads were
 * written relative to what `/map-images` serves, which made uploads show up
 * at all, but both sides of that fix still pointed inside the container's
 * writable layer, so the images still did not survive an update.
 *
 * The URL is unchanged: `index.ts` mounts `express.static(MAP_IMAGES_DIR)`
 * at `/map-images`, so images are still served from `/map-images/<file>`
 * and `imageUrl` values already stored on maps keep resolving. Only the
 * directory behind that mount moved.
 *
 * `MAP_IMAGES_DIR` is computed once, here, and imported by both the static
 * setup (api entry, `index.ts`) and the map upload route
 * (`integrations/cs2/maps/routes.ts`) so the two can never drift apart again
 * the way they did before #290 -- see that PR for how they drifted.
 */
export const MAP_IMAGES_DIR = path.join(DATA_DIR, 'map-images');

/**
 * Every directory uploaded map images lived in before `MAP_IMAGES_DIR` moved
 * onto the volume, newest first:
 *
 * 1. `<PUBLIC_DIR>/map-images` -- where #290 put them. Correct relative to
 *    the static mount, but inside the image.
 * 2. `<PUBLIC_DIR>/../../public/map-images` -- where the bundled build wrote
 *    them before #290: one directory above `PUBLIC_DIR` (`/public` rather
 *    than `/app/public` in Docker). Installs that never ran a build carrying
 *    #290 still have their images sitting here.
 *
 * Both only ever existed in the bundled build/Docker. In dev, (1) is simply
 * where images already were, and (2) never existed.
 *
 * Used solely by `config/migrateLegacyMapImages.ts`, which moves anything
 * left in either one into `MAP_IMAGES_DIR` once, on startup.
 */
export const LEGACY_MAP_IMAGES_DIRS = [
  path.join(PUBLIC_DIR, 'map-images'),
  path.join(PUBLIC_DIR, '..', '..', 'public', 'map-images'),
];
