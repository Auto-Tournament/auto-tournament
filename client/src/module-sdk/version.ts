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
 * `^0.1.0` already means "0.1 only". Bump the patch for an added slot, prop,
 * SDK export or shared package, which `^0.1.0` still matches, and the minor
 * for any removal or narrowing, which is a break.
 *
 * 0.1.1: `links`, `openMatchDetails`, `useSocket`, `SegmentedControl`, and
 * `useAuth().playerUid`.
 *
 * 0.2.0 (breaking, item 8b: "ids in, the module fetches its own"):
 * - `dashboardWidgets.adminHomeResources` takes no props (was `fleet`,
 *   `pluginVersions`).
 * - `dashboardWidgets.manageResources` takes `{ tournamentId }` (was
 *   `servers`, `matches`).
 * - `matchPanels.adminView` takes `{ tournamentId }` (was `servers`,
 *   `gracePeriodSeconds`, `requiredServerCount`) and renders nothing when it
 *   has nothing to show.
 * - `preMatchHistory` takes `{ matchSlug }` (was `actions`, `team1Name`,
 *   `team2Name`) and renders nothing when there is no record.
 * - `preMatchView`'s `onComplete()` takes no argument (was the veto state).
 * - The six queue slots' `availability` is `ResourceAvailability`: the
 *   module's own answer, of which core reads only `nextAllocationInSeconds`.
 * - `resourceDialogs.add` / `.batchAdd` take `{ open, onClose, onSaved }`
 *   (were `server`, `servers` / `existingServers`, `onSave(createdIds)`).
 * - `standaloneMatchSteps.rules` / `.content` (21 + 16 props of core-held
 *   state) are gone; one optional slot, `standaloneMatch`, takes
 *   `{ open, onClose, onCreated(matchSlug) }` and owns the whole form.
 * - `matchPanels.teamView` takes `{ matchSlug, viewerCanJoin, matchStatus? }`
 *   (was `server`, `currentMapData`, `currentMapNumber`, `connected`,
 *   `copied`, `onConnect`, `onCopy`); CS2 reads
 *   `GET /api/game/cs2/matches/:slug/connect`.
 * - `tournamentSetupSteps.rules` / `.content` take `TournamentSettingsStepProps`
 *   `{ settings, onChange, game, type, format, disabled }`, the tournament's
 *   settings object in which the module edits its own key (were the round
 *   rules as `value` / `maxRoundsTestId`, and 14 props of map pools, maps and
 *   callbacks); `.settings` gets `type` as well. Added: the optional
 *   `tournamentSetupSteps.review` slot and the `tournamentSetup` model.
 */
export const CLIENT_API_VERSION = '0.2.0';
