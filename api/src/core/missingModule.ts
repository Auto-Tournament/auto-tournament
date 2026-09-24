/**
 * The integration the registry answers with when this instance has no module
 * for a row's game (DESIGN-module-client-api §4.4, "a module that is absent").
 *
 * Until modules could be uninstalled, `integrationForMatch` had two ways out
 * for a game nothing ran: fall back to CS2, or throw. Neither is right once
 * CS2 itself can be absent. Falling back to CS2 claims a tournament is a game
 * it is not, and on an instance without CS2 there is nothing to fall back to.
 * Throwing turns every caller that reads `integrationForMatch(row).capabilities`
 * into a 500.
 *
 * So the registry hands back this instead: a valid `GameIntegration` in every
 * slot, with nothing in any of them. It has no capabilities, no routes, no
 * settings, no catalogue entry and no stats; it reads a stored match config
 * without failing; and everything that would *do* something for the game —
 * build a match, start the tournament, allocate, restart — refuses with a
 * message that names the game whose module is missing.
 *
 * It is core, not an integration: it is never registered, so it is never in
 * `listIntegrations()`, never mounts a route and never seeds anything.
 */

import type { GameId, GameIntegration, MatchDescription } from '../integrations/types';

/** The placeholder's `id`. Never a real module's, and never stored in a row. */
export const MISSING_MODULE_ID = 'module-not-installed';

/** A game-specific action was asked of a game whose module is not installed. */
export class ModuleNotInstalledError extends Error {
  constructor(public readonly game: GameId) {
    super(moduleNotInstalledMessage(game));
    this.name = 'ModuleNotInstalledError';
  }
}

export function moduleNotInstalledMessage(game: GameId): string {
  return `The game module for '${game}' is not installed on this instance.`;
}

function nameFrom(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name;
  }
  return fallback;
}

/**
 * What the placeholder can say about a stored config without knowing its
 * shape: the team names when the config has them the way every module so far
 * stores them, one game, no maps and no roster.
 */
function describeUnknownConfig(config: unknown): MatchDescription {
  let value: unknown = config;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const object =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    seriesLength: 1,
    maps: [],
    team1: { name: nameFrom(object.team1, 'Team 1'), players: [] },
    team2: { name: nameFrom(object.team2, 'Team 2'), players: [] },
  };
}

/** The placeholder for `game`, a value no installed module runs. */
export function missingModuleIntegration(game: GameId): GameIntegration {
  const message = moduleNotInstalledMessage(game);
  return {
    id: MISSING_MODULE_ID,
    displayName: `${game} (module not installed)`,
    notInstalled: game,
    capabilities: {
      servers: false,
      veto: false,
      liveEvents: false,
      demos: false,
      playerStats: false,
    },
    // Not a game this instance offers, so not in the catalogue.
    catalog: null,

    statsSchema: () => ({ metrics: [] }),

    async buildMatchConfig() {
      throw new ModuleNotInstalledError(game);
    },
    describeMatch: describeUnknownConfig,

    // A start is refused up front, with the reason, rather than going live
    // with matches nothing can run.
    async checkStart() {
      return { ok: false, errorCode: 'module_not_installed', message, details: { game } };
    },
    // No servers: the contract's "unlimited", so nothing waits on a pool that
    // does not exist. `allocate` is what says no.
    async capacity() {
      return null;
    },
    async allocate() {
      return { status: 'failed', error: message, retryable: false };
    },
    async restart() {
      return { ok: false, error: message };
    },
  };
}
