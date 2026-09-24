import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { DbMatchRow, DbTournamentRow } from '../../../types/database.types';
import type { TournamentResponse } from '../../../types/tournament.types';
import { getVetoOrder } from './config';
import { emitVetoUpdate } from '../../../services/socketService';
import { settingsService } from '../../../services/settingsService';
import { buildMatchConfigFor, serializeMatchConfig } from '../../../utils/matchIntegration';
import { isQueuedAllocationResult, scheduler } from '../../../core/scheduler';
import { tournamentIdForMatch, tournamentRowToResponse } from '../../../utils/tournamentRow';

type VetoActionType = 'ban' | 'pick' | 'side_pick';
type VetoTeam = 'team1' | 'team2';

interface VetoStep {
  step: number;
  team: VetoTeam;
  action: VetoActionType;
}

interface VetoPickedMap {
  mapNumber: number;
  mapName: string;
  pickedBy: VetoTeam | 'decider';
  knifeRound: boolean;
  sideTeam1?: 'CT' | 'T';
  sideTeam2?: 'CT' | 'T';
}

interface VetoState {
  matchSlug: string;
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'pending' | 'in_progress' | 'completed';
  currentStep: number;
  totalSteps: number;
  availableMaps: string[];
  bannedMaps: string[];
  pickedMaps: VetoPickedMap[];
  allMaps?: string[];
  actions: Array<{
    step: number;
    team: VetoTeam;
    action: VetoActionType;
    mapName: string;
    side?: 'CT' | 'T';
    timestamp: string;
  }>;
  currentTurn: VetoTeam;
  currentAction: VetoActionType;
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  completedAt?: string;
}

const DEFAULT_STEP_DELAY_MS = 1000;

function getRandomElement<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Automatically complete the veto for a given match when simulation mode is enabled.
 *
 * This runs entirely on the backend:
 *  - Randomly bans/picks maps following the tournament's veto order.
 *  - Randomly picks sides when required.
 *  - Emits Socket.IO veto updates so any open UIs stay in sync.
 *  - On completion, recomputes Auto Tournament CS2 config and triggers normal allocation logic.
 */
export async function autoCompleteVetoForMatch(
  matchSlug: string,
  options?: { stepDelayMs?: number }
): Promise<void> {
  // Two runs on one match would both walk the veto steps and overwrite each
  // other's picks. Toggling simulation while tournament start or match
  // progression is already vetoing a match would do exactly that.
  if (vetoRunsInFlight.has(matchSlug)) {
    log.debug(`[VETO-SIM] Auto veto already running for ${matchSlug}; skipping duplicate run`);
    return;
  }

  vetoRunsInFlight.add(matchSlug);
  try {
    await runAutoVeto(matchSlug, options);
  } catch (error) {
    log.error(`[VETO-SIM] Automated veto failed for match ${matchSlug}`, error);
  } finally {
    vetoRunsInFlight.delete(matchSlug);
  }
}

/** Slugs whose automated veto is currently running in this process. */
const vetoRunsInFlight = new Set<string>();

type StoredVetoStatus = 'none' | 'in_progress' | 'completed' | 'invalid';

/** Read the veto progress stored on a match row without trusting the JSON. */
function storedVetoStatus(rawVetoState: string | null | undefined): StoredVetoStatus {
  if (!rawVetoState) return 'none';
  try {
    const parsed = JSON.parse(rawVetoState) as { status?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return 'invalid';
    return parsed.status === 'completed' ? 'completed' : 'in_progress';
  } catch {
    return 'invalid';
  }
}

function isVetoCompleted(rawVetoState: string | null | undefined): boolean {
  return storedVetoStatus(rawVetoState) === 'completed';
}

/**
 * Start an automated veto for every match in the tournament that is waiting on
 * one: both teams known, no server yet, and a veto that is missing or
 * unfinished. An unfinished veto (players started it by hand) is resumed from
 * its current step.
 *
 * Used when a tournament starts in simulation mode and when simulation is
 * switched on while a tournament is already running. Runs are started in the
 * background; the returned slugs are the matches that were kicked off.
 * Does nothing (returns []) when simulation mode is off, which also covers the
 * production guard (AT_ENABLE_SIMULATION_IN_PROD).
 */
export async function autoVetoPendingMatches(
  tournamentId: number,
  options?: { stepDelayMs?: number }
): Promise<string[]> {
  if (!(await settingsService.isSimulationModeEnabled())) {
    return [];
  }

  // Shuffle tournaments never use veto, whatever their format.
  const tournament = await db.queryOneAsync<Pick<DbTournamentRow, 'type' | 'format'>>(
    'SELECT type, format FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (
    !tournament ||
    tournament.type === 'shuffle' ||
    !['bo1', 'bo3', 'bo5'].includes(String(tournament.format).toLowerCase())
  ) {
    return [];
  }

  const candidates = await db.queryAsync<DbMatchRow>(
    `SELECT * FROM matches
     WHERE tournament_id = ?
       AND status IN ('pending', 'ready')
       AND team1_id IS NOT NULL
       AND team2_id IS NOT NULL
       AND (server_id IS NULL OR server_id = '')`,
    [tournamentId]
  );

  const slugs: string[] = [];
  for (const match of candidates) {
    const vetoStatus = storedVetoStatus(match.veto_state);
    if (vetoStatus === 'completed') continue;
    if (vetoStatus === 'invalid') {
      log.warn(`[VETO-SIM] Match ${match.slug} has an unreadable veto_state; not auto-vetoing it`);
      continue;
    }
    slugs.push(match.slug);
  }

  for (const slug of slugs) {
    setImmediate(() => {
      void autoCompleteVetoForMatch(slug, { stepDelayMs: options?.stepDelayMs ?? 1000 });
    });
  }

  return slugs;
}

async function runAutoVeto(
  matchSlug: string,
  options?: { stepDelayMs?: number }
): Promise<void> {
  const stepDelayMs = options?.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;

  const simulationEnabled = await settingsService.isSimulationModeEnabled();
  if (!simulationEnabled) {
    log.debug(
      `[VETO-SIM] Simulation mode disabled; skipping auto veto for match ${matchSlug}`
    );
    return;
  }

  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
    matchSlug,
  ]);
  if (!match) {
    log.warn(`[VETO-SIM] Match ${matchSlug} not found; skipping auto veto`);
    return;
  }

  // Only auto-veto matches that already have both teams assigned.
  // Bracket "TBD vs TBD" slots (future rounds) should behave exactly like
  // they would for real players: they are not ready yet, so we do not
  // simulate bans/picks or attempt to load them onto a server.
  if (!match.team1_id || !match.team2_id) {
    log.debug(
      `[VETO-SIM] Match ${matchSlug} does not have both teams assigned (team1_id=${match.team1_id}, team2_id=${match.team2_id}); skipping auto veto`
    );
    return;
  }

  // Prefer to run auto-veto while the match is still 'pending'. However, to
  // support already-initialized brackets or restart flows, we also allow a
  // one-time auto-veto for matches in 'ready' status that have no veto_state
  // and are not yet loaded on a server.
  // A veto that players started by hand before simulation was switched on is
  // resumed from its current step, so 'ready' matches with an unfinished veto
  // qualify too.
  if (match.status !== 'pending') {
    const hasVetoState = Boolean(match.veto_state);
    const isReadyAndIdle =
      match.status === 'ready' && !isVetoCompleted(match.veto_state) && !match.server_id;

    if (!isReadyAndIdle) {
      log.debug(
        `[VETO-SIM] Match ${matchSlug} has status '${match.status}' and is not eligible for auto veto (veto_state=${hasVetoState}, server_id=${match.server_id}); skipping`
      );
      return;
    }
  }

  // Load tournament
  const t = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
    tournamentIdForMatch(match),
  ]);
  if (!t) {
    log.warn(`[VETO-SIM] Tournament not found for match ${matchSlug}; skipping auto veto`);
    return;
  }

  const tournament: TournamentResponse = tournamentRowToResponse(t);

  // Only BO formats use veto; safeguard here in case caller forgot.
  if (!['bo1', 'bo3', 'bo5'].includes(tournament.format)) {
    log.debug(
      `[VETO-SIM] Tournament format ${tournament.format} does not use veto – skipping auto veto for ${matchSlug}`
    );
    return;
  }

  const format = tournament.format as 'bo1' | 'bo3' | 'bo5';
  const tournamentMaps: string[] = tournament.maps;
  const tournamentSettings = tournament.settings || {};
  const customVetoOrder = (tournamentSettings as { customVetoOrder?: unknown })
    .customVetoOrder;
  const vetoOrder = getVetoOrder(format, customVetoOrder, tournamentMaps.length) as VetoStep[];

  if (!vetoOrder.length) {
    log.warn(
      `[VETO-SIM] Empty veto order for match ${matchSlug}; skipping auto veto`
    );
    return;
  }

  // Load or initialize veto state
  let vetoState: VetoState | null = match.veto_state
    ? (JSON.parse(match.veto_state) as VetoState)
    : null;

  if (vetoState && vetoState.status === 'completed') {
    log.debug(`[VETO-SIM] Veto already completed for ${matchSlug}; nothing to do`);
    return;
  }

  if (vetoState) {
    log.info(
      `[VETO-SIM] Resuming veto for match ${matchSlug} at step ${vetoState.currentStep}/${vetoState.totalSteps}`
    );
  } else {
    vetoState = {
      matchSlug,
      format,
      status: 'in_progress',
      currentStep: 1,
      totalSteps: vetoOrder.length,
      availableMaps: [...tournamentMaps],
      bannedMaps: [],
      pickedMaps: [],
      allMaps: [...tournamentMaps],
      actions: [],
      currentTurn: vetoOrder[0].team,
      currentAction: vetoOrder[0].action,
      team1Id: match.team1_id ?? undefined,
      team2Id: match.team2_id ?? undefined,
      team1Name: undefined,
      team2Name: undefined,
    };
  }

  log.info(`[VETO-SIM] Starting automated veto for match ${matchSlug}`);

  while (vetoState.currentStep <= vetoState.totalSteps) {
    const currentStepConfig = vetoOrder[vetoState.currentStep - 1];
    const currentAction = currentStepConfig.action;

    let selectedMap: string | undefined;
    let selectedSide: 'CT' | 'T' | undefined;

    if (currentAction === 'ban' || currentAction === 'pick') {
      if (!vetoState.availableMaps.length) {
        log.warn(
          `[VETO-SIM] No available maps left for ${currentAction} on match ${matchSlug}; breaking`
        );
        break;
      }
      selectedMap = getRandomElement(vetoState.availableMaps);
    } else if (currentAction === 'side_pick') {
      selectedSide = Math.random() > 0.5 ? 'CT' : 'T';
    }

    // Apply the same logic as the /api/veto/:matchSlug/action route.
    if (currentAction === 'ban' && selectedMap) {
      vetoState.availableMaps = vetoState.availableMaps.filter((m) => m !== selectedMap);
      vetoState.bannedMaps.push(selectedMap);
      vetoState.actions.push({
        step: vetoState.currentStep,
        team: currentStepConfig.team,
        action: 'ban',
        mapName: selectedMap,
        timestamp: new Date().toISOString(),
      });
    } else if (currentAction === 'pick' && selectedMap) {
      const mapNumber = vetoState.pickedMaps.length + 1;
      vetoState.availableMaps = vetoState.availableMaps.filter((m) => m !== selectedMap);
      vetoState.pickedMaps.push({
        mapNumber,
        mapName: selectedMap,
        pickedBy: currentStepConfig.team,
        knifeRound: false,
      });
      vetoState.actions.push({
        step: vetoState.currentStep,
        team: currentStepConfig.team,
        action: 'pick',
        mapName: selectedMap,
        timestamp: new Date().toISOString(),
      });
    } else if (currentAction === 'side_pick' && selectedSide) {
      // For BO1/BO3 last step, ensure decider map is added if only one remains
      if (
        (format === 'bo1' || format === 'bo3') &&
        vetoState.currentStep === vetoState.totalSteps &&
        vetoState.availableMaps.length === 1
      ) {
        const deciderMap = vetoState.availableMaps[0];
        vetoState.pickedMaps.push({
          mapNumber: vetoState.pickedMaps.length + 1,
          mapName: deciderMap,
          pickedBy: 'decider',
          knifeRound: false,
        });
        vetoState.availableMaps = [];
      }

      const lastPick = vetoState.pickedMaps[vetoState.pickedMaps.length - 1];
      if (lastPick) {
        if (currentStepConfig.team === 'team1') {
          lastPick.sideTeam1 = selectedSide;
          lastPick.sideTeam2 = selectedSide === 'CT' ? 'T' : 'CT';
        } else {
          lastPick.sideTeam2 = selectedSide;
          lastPick.sideTeam1 = selectedSide === 'CT' ? 'T' : 'CT';
        }
      }

      vetoState.actions.push({
        step: vetoState.currentStep,
        team: currentStepConfig.team,
        action: 'side_pick',
        mapName: lastPick?.mapName || 'unknown',
        side: selectedSide,
        timestamp: new Date().toISOString(),
      });
    }

    vetoState.currentStep += 1;

    // Persist and emit after each step so UI updates live
    await db.updateAsync('matches', { veto_state: JSON.stringify(vetoState) }, 'slug = ?', [
      matchSlug,
    ]);
    emitVetoUpdate(matchSlug, vetoState);

    // Check for completion
    if (vetoState.currentStep > vetoState.totalSteps) {
      vetoState.status = 'completed';
      vetoState.completedAt = new Date().toISOString();

      // Handle any remaining decider map (primarily BO5)
      if (vetoState.availableMaps.length === 1 && format !== 'bo1' && format !== 'bo3') {
        const deciderMap = vetoState.availableMaps[0];
        vetoState.pickedMaps.push({
          mapNumber: vetoState.pickedMaps.length + 1,
          mapName: deciderMap,
          pickedBy: 'decider',
          knifeRound: format === 'bo5',
        });
        vetoState.availableMaps = [];
      }

      await db.updateAsync(
        'matches',
        { veto_state: JSON.stringify(vetoState), status: 'ready' },
        'slug = ?',
        [matchSlug]
      );
      emitVetoUpdate(matchSlug, vetoState);

      log.success(`[VETO-SIM] Automated veto completed for match ${matchSlug}`, {
        pickedMaps: vetoState.pickedMaps.map((m) => m.mapName),
      });

      // Recompute and persist fresh config
      try {
        const cfg = await buildMatchConfigFor(
          {
            slug: matchSlug,
            id: match.id,
            game: match.game,
            round: match.round,
            bracket: match.bracket,
            team1Id: match.team1_id,
            team2Id: match.team2_id,
          },
          tournament
        );
        await db.updateAsync('matches', { config: serializeMatchConfig(cfg) }, 'slug = ?', [
          matchSlug,
        ]);
        log.success(
          `[VETO-SIM] Stored fresh config for match ${matchSlug} after automated veto`
        );
      } catch (e) {
        log.error(
          `[VETO-SIM] Failed to generate/store config after automated veto for ${matchSlug}`,
          e as Error
        );
      }

      // Auto-allocate and load match, same as manual veto completion path
      const baseUrl = await settingsService.getWebhookUrl();
      if (!baseUrl) {
        log.warn(
          `[VETO-SIM] Webhook URL not configured; skipping auto-load for match ${matchSlug} after automated veto`
        );
      } else {
        setImmediate(async () => {
          try {
            const result = await scheduler.allocateSingleMatch(matchSlug, baseUrl);
            if (result.success) {
              log.success(
                `[VETO-SIM] Match ${matchSlug} loaded on server ${result.serverId} after automated veto`
              );
            } else {
              if (isQueuedAllocationResult(result.error)) {
                log.info(
                  `[VETO-SIM] Match ${matchSlug} queued for a server after automated veto: ${result.error}`
                );
              } else {
                log.warn(
                  `[VETO-SIM] Failed to allocate server for match ${matchSlug} after automated veto: ${result.error}`
                );
              }
              scheduler.startPollingForServer(matchSlug, baseUrl);
            }
          } catch (err) {
            log.error(
              `[VETO-SIM] Error loading match after automated veto for ${matchSlug}`,
              err as Error
            );
            scheduler.startPollingForServer(matchSlug, baseUrl);
          }
        });
      }

      break;
    } else {
      const nextStepConfig = vetoOrder[vetoState.currentStep - 1];
      vetoState.currentTurn = nextStepConfig.team;
      vetoState.currentAction = nextStepConfig.action;

      // Small delay between automated steps to mimic human veto flow
      if (stepDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
      }
    }
  }
}


