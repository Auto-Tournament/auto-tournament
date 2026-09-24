/**
 * The client API version this platform provides to game modules loaded at
 * runtime (DESIGN-module-client-api.md, decision 1 and §4.3).
 *
 * A code module declares the range it works with in `module.json`
 * (`"clientApi": "^0.1.0"`), and the loader refuses one whose range this
 * version does not satisfy, before fetching any of its code.
 *
 * It stays `0.x` in lockstep with the platform until a module that is not
 * ours depends on it. Under semver a `0.x` minor may break, so a module's
 * `^0.1.0` already means "0.1 only". Bump the minor for an added slot, prop,
 * SDK export or shared package, and treat any removal or narrowing as a
 * break.
 */
export const CLIENT_API_VERSION = '0.1.0';
