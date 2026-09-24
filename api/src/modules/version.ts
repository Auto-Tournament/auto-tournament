/**
 * The API versions this platform offers to installable code modules.
 *
 * A module's `module.json` declares the range of each it works with
 * (`"serverApi": "^0.1.0"`, `"clientApi": "^0.1.0"`), and the loader refuses
 * one whose range this platform's version does not satisfy
 * (DESIGN-module-client-api, decision 1, and §4.3).
 *
 * These are independent of the platform's own version. The server API is the
 * `GameIntegration` contract (`integrations/types.ts`) plus what a module's
 * server half may import from the platform. While it is `0.x`, `^0.1.0` means
 * "0.1 only": under semver a `0.x` minor may break.
 */

/** The server API version: the `GameIntegration` contract. */
export const SERVER_API_VERSION = '0.1.0';

/**
 * The client API version the web client provides. The client owns it
 * (`client/src/module-sdk/version.ts`); this copy is what `GET /api/modules`
 * reports and what the server checks a module's `clientApi` range against, so
 * a module the browser would refuse is never loaded on the server either.
 * Keep the two equal.
 */
export const CLIENT_API_VERSION = '0.2.2';
