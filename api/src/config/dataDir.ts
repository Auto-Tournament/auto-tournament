import path from 'path';

/**
 * Where demos, event logs and other persistent runtime data live on disk.
 *
 * Two layouts, same trick `config/publicPaths.ts` uses for `PUBLIC_DIR`/
 * `MAP_IMAGES_DIR`: under tsx/ts-node in dev, this module's own `__dirname`
 * is `api/src/config`, two levels below the API root, so `DEFAULT_DATA_DIR`
 * resolves to `api/data`. In the esbuild bundle every module is flattened
 * into a single `dist/index.js`, so `__dirname` is `dist/` itself -- only one
 * level below the API root (`/app` in Docker) -- and the `.ts` check below
 * compensates so both environments resolve to the same place.
 *
 * Previously this counted `..` twice unconditionally, which was correct in
 * dev but landed on `/data` instead of `/app/data` in the release image --
 * one directory above where `docker/docker-compose.yml` mounts the volume,
 * so demos and logs written there were lost on every container recreate.
 *
 * `DATA_DIR` can be overridden with the `DATA_DIR` env var for operators who
 * want data stored somewhere else.
 */
const upToApiRoot = __filename.endsWith('.ts') ? ['..', '..'] : ['..'];
const DEFAULT_DATA_DIR = path.join(__dirname, ...upToApiRoot, 'data');

export const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;

/**
 * Where `DATA_DIR` incorrectly resolved to before this fix, relative to the
 * *default* (non-overridden) resolution -- one directory above the API root
 * instead of inside it (`/data` instead of `/app/data` in Docker). Only
 * relevant to the bundled build/Docker: in dev the old code already resolved
 * to `api/data`, i.e. `DEFAULT_DATA_DIR`, so this points at a directory that
 * never existed there.
 *
 * Used solely by `config/migrateLegacyDataDir.ts` to move any demos/logs left
 * behind by existing installs into `DATA_DIR` once, on startup.
 */
export const LEGACY_DATA_DIR = path.join(DEFAULT_DATA_DIR, '..', '..', 'data');
