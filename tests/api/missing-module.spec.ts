import { test, expect } from '@playwright/test';
import {
  getIntegration,
  integrationForMatch,
  listIntegrations,
  resolveGameRef,
  resolveIntegrationForRow,
} from '../../api/src/integrations/registry';
import {
  MISSING_MODULE_ID,
  ModuleNotInstalledError,
  missingModuleIntegration,
} from '../../api/src/core/missingModule';
import type { GameIntegration, MatchContext } from '../../api/src/integrations/types';
import {
  MISSING_MODULE_ID as CLIENT_MISSING_MODULE_ID,
  missingModuleIntegration as clientMissingModule,
  resolveIntegration as resolveClientIntegration,
} from '../../client/src/utils/moduleResolution';
import type { ClientGameIntegration } from '../../client/src/integrations/types';

/**
 * The "module not installed" placeholder (DESIGN-module-client-api §4.4).
 *
 * Both registries used to fall back to CS2 for a game they did not know. That
 * is wrong for a game that is not CS2, and on an instance without CS2 the
 * fallback is `undefined`, so every `integrationFor(row).capabilities` would
 * throw. They now answer with a placeholder that is valid in every slot.
 *
 * CS2 cannot be uninstalled yet, so this runs the registries' lookup over
 * lists of modules of its own — CS2 alone, manual-report alone, nothing —
 * next to the real registry, which must still answer exactly as before. It
 * runs in this process and never touches the server or a database.
 *
 * Which inputs reach the fallback on today's instances (CS2 and manual-report
 * both installed): on the client, none — manual-report runs any catalogue game
 * (`runsAnyCatalogGame`), so every non-CS2 value resolves to it. On the API,
 * only a `game` that is blank after trimming ('  '), which the ref lookup
 * rejects before the catch-all; that used to throw `UnknownGameError` and is
 * now the placeholder.
 *
 * @tag api
 */

const cs2 = getIntegration('cs2');
const manualReport = getIntegration('manual-report');

// ---------------------------------------------------------------------------
// API registry
// ---------------------------------------------------------------------------

test.describe('Missing module placeholder (API registry)', () => {
  test('the real registry still resolves CS2 rows and catalogue games as before', () => {
    for (const row of [{}, { game: null }, { game: '' }, { game: 'cs2' }, { game: ' CS2 ' }]) {
      expect(integrationForMatch(row), JSON.stringify(row)).toBe(cs2);
    }
    for (const game of ['counter-strike-2', 'csgo']) {
      expect(integrationForMatch({ game }), game).toBe(cs2);
    }
    // Everything else that is not blank is manual-report's, through
    // runsAnyCatalogGame — so it never reaches the fallback today.
    for (const game of ['rocket-league', 'no-such-game', 'cs3', 'manual-report']) {
      expect(integrationForMatch({ game }), game).toBe(manualReport);
    }
  });

  test('a blank game is the only input that reaches the fallback today', () => {
    const answer = integrationForMatch({ game: '   ' });
    expect(answer.id).toBe(MISSING_MODULE_ID);
    expect(answer).not.toBe(cs2);
  });

  test('the lookup over the installed list is the registry lookup', () => {
    const installed = listIntegrations();
    for (const game of [undefined, null, '', 'cs2', 'CS2', 'counter-strike-2', 'rocket-league', 'x']) {
      expect(resolveIntegrationForRow({ game }, installed), String(game)).toBe(
        integrationForMatch({ game })
      );
    }
  });

  test('without a catch-all module, an unknown game is the placeholder, not CS2', () => {
    const installed = [cs2];
    const answer = resolveIntegrationForRow({ game: 'rocket-league' }, installed);
    expect(answer.id).toBe(MISSING_MODULE_ID);
    expect(answer.notInstalled).toBe('rocket-league');
    expect(resolveGameRef('rocket-league', installed)).toBeNull();
    // A row with no game is still CS2's.
    expect(resolveIntegrationForRow({}, installed)).toBe(cs2);
    expect(resolveIntegrationForRow({ game: null }, installed)).toBe(cs2);
    expect(resolveIntegrationForRow({ game: 'cs2' }, installed)).toBe(cs2);
    expect(resolveIntegrationForRow({ game: 'counter-strike-2' }, installed)).toBe(cs2);
  });

  test('without CS2, a CS2 row is the placeholder, not the catch-all module', () => {
    const installed = [manualReport];
    for (const row of [{}, { game: null }, { game: '' }, { game: 'cs2' }]) {
      const answer = resolveIntegrationForRow(row, installed);
      expect(answer.id, JSON.stringify(row)).toBe(MISSING_MODULE_ID);
      expect(answer.notInstalled, JSON.stringify(row)).toBe('cs2');
    }
    // A game the catch-all runs is still its own.
    expect(resolveIntegrationForRow({ game: 'rocket-league' }, installed)).toBe(manualReport);
  });

  test('with nothing installed, every row gets the placeholder and nothing throws', () => {
    for (const row of [{}, { game: 'cs2' }, { game: 'rocket-league' }, { game: '  ' }]) {
      const answer = resolveIntegrationForRow(row, []);
      expect(answer.id).toBe(MISSING_MODULE_ID);
      expect(answer.capabilities.servers).toBe(false);
    }
  });

  test('the placeholder is empty in every slot and never registered', () => {
    const placeholder = missingModuleIntegration('cs2');
    expect(placeholder.notInstalled).toBe('cs2');
    expect(placeholder.capabilities).toEqual({
      servers: false,
      veto: false,
      liveEvents: false,
      demos: false,
      playerStats: false,
    });
    expect(placeholder.catalog).toBeNull();
    expect(placeholder.runsAnyCatalogGame).toBeUndefined();
    expect(placeholder.routes).toBeUndefined();
    expect(placeholder.legacyRoutes).toBeUndefined();
    expect(placeholder.instanceSettings).toBeUndefined();
    expect(placeholder.seed).toBeUndefined();
    expect(placeholder.statsSchema(null)).toEqual({ metrics: [] });
    expect(listIntegrations().map((i) => i.id)).not.toContain(MISSING_MODULE_ID);
  });

  test('everything that would run the game refuses, naming the missing module', async () => {
    const placeholder = missingModuleIntegration('cs2');
    const ctx: MatchContext = {
      slug: 'r1m1',
      matchId: 1,
      game: 'cs2',
      tournament: null,
      team1: null,
      team2: null,
      round: 1,
      integrationConfig: {},
    };

    await expect(placeholder.buildMatchConfig(ctx)).rejects.toBeInstanceOf(ModuleNotInstalledError);
    await expect(placeholder.buildMatchConfig(ctx)).rejects.toThrow(/'cs2' is not installed/);

    const start = await placeholder.checkStart!({ tournamentId: 1 });
    expect(start).toMatchObject({ ok: false, errorCode: 'module_not_installed' });

    const allocated = await placeholder.allocate(ctx, { baseUrl: '' });
    expect(allocated).toMatchObject({ status: 'failed', retryable: false });
    expect(allocated.status === 'failed' && allocated.error).toMatch(/not installed/);

    const restarted = await placeholder.restart(ctx, { baseUrl: '' });
    expect(restarted.ok).toBe(false);
  });

  test('it still reads a stored config, keeping the team names', () => {
    const placeholder = missingModuleIntegration('cs2') as GameIntegration;
    const described = placeholder.describeMatch(
      JSON.stringify({ team1: { name: 'Alpha' }, team2: { name: 'Bravo' }, maplist: ['de_dust2'] })
    );
    expect(described).toEqual({
      seriesLength: 1,
      maps: [],
      team1: { name: 'Alpha', players: [] },
      team2: { name: 'Bravo', players: [] },
    });
  });
});

// ---------------------------------------------------------------------------
// Client registry
// ---------------------------------------------------------------------------

/**
 * Stand-ins for the client's CS2 and manual-report modules: the registry
 * imports their React components, which do not load in Node. Only what the
 * lookup reads is set.
 */
function clientModule(
  id: string,
  extra: Partial<ClientGameIntegration> = {}
): ClientGameIntegration {
  return {
    ...clientMissingModule(id),
    notInstalled: undefined,
    id,
    ...extra,
  };
}
const clientCs2 = clientModule('cs2', { catalogSlug: 'counter-strike-2' });
const clientManual = clientModule('manual-report', { runsAnyCatalogGame: true });

test.describe('Missing module placeholder (client registry)', () => {
  test('with both modules, it answers exactly what it answered before', () => {
    const installed = [clientCs2, clientManual];
    for (const game of [undefined, null, '', 'cs2', ' CS2 ']) {
      expect(resolveClientIntegration(game, installed), String(game)).toBe(clientCs2);
    }
    // Nothing reaches the fallback: the catch-all takes every other value,
    // blank ones included.
    for (const game of ['rocket-league', 'no-such-game', '  ', 'manual-report']) {
      expect(resolveClientIntegration(game, installed), game).toBe(clientManual);
    }
  });

  test('without a catch-all, an unknown game is the placeholder, not CS2', () => {
    const answer = resolveClientIntegration('rocket-league', [clientCs2]);
    expect(answer.id).toBe(CLIENT_MISSING_MODULE_ID);
    expect(answer.notInstalled).toBe('rocket-league');
    expect(resolveClientIntegration(undefined, [clientCs2])).toBe(clientCs2);
  });

  test('without CS2, a CS2 row is the placeholder, not the catch-all module', () => {
    for (const game of [undefined, null, '', 'cs2']) {
      const answer = resolveClientIntegration(game, [clientManual]);
      expect(answer.id, String(game)).toBe(CLIENT_MISSING_MODULE_ID);
      expect(answer.notInstalled, String(game)).toBe('cs2');
    }
    expect(resolveClientIntegration('rocket-league', [clientManual])).toBe(clientManual);
  });

  test('the placeholder is valid in every slot, and empty in all of them', () => {
    const placeholder = resolveClientIntegration('cs2', []);
    expect(placeholder.notInstalled).toBe('cs2');
    expect(Object.values(placeholder.capabilities).every((v) => v === false)).toBe(true);
    // The objects the core reads a slot from are there, so `x.slots.y` is
    // undefined rather than a TypeError.
    for (const group of [
      placeholder.matchPanels,
      placeholder.tournamentSetupSteps,
      placeholder.resourceDialogs,
      placeholder.dashboardWidgets,
    ]) {
      expect(group).toEqual({});
    }
    expect(placeholder.routes).toEqual([]);
    expect(placeholder.navItems).toEqual([]);
    for (const slot of [
      'teamAdminPanel',
      'rosterMemberStatus',
      'adminGlobalWarning',
      'tournamentStart',
      'matchQueueBanner',
      'matchQueueChip',
      'matchListQueue',
      'manageStatusTile',
      'resourceAvailabilityEndpoint',
      'adminDisputesView',
      'tournamentStatsView',
      'preMatchView',
      'preMatchHistory',
      'standaloneMatch',
      'catalogSlug',
      'catalogIcon',
      'runsAnyCatalogGame',
    ] as const) {
      expect(placeholder[slot], slot).toBeUndefined();
    }
  });
});
