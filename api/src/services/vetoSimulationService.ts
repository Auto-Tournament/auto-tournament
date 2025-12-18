import { db } from '../config/database';
import { log } from '../utils/logger';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';
import { getVetoOrder } from '../utils/vetoConfig';
import { emitVetoUpdate } from './socketService';
import { settingsService } from './settingsService';
import { generateMatchConfig } from './matchConfigBuilder';
import { matchAllocationService } from './matchAllocationService';

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
 *  - On completion, recomputes MatchZy config and triggers normal allocation logic.
 */
export async function autoCompleteVetoForMatch(
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

  // Only auto-veto for pending matches; anything else is either already in progress or done.
  if (match.status !== 'pending') {
    log.debug(
      `[VETO-SIM] Match ${matchSlug} has status '${match.status}', not 'pending' – skipping auto veto`
    );
    return;
  }

  // Load tournament
  const t = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
    match.tournament_id ?? 1,
  ]);
  if (!t) {
    log.warn(`[VETO-SIM] Tournament not found for match ${matchSlug}; skipping auto veto`);
    return;
  }

  const tournament: TournamentResponse = {
    id: t.id,
    name: t.name,
    type: t.type as TournamentResponse['type'],
    format: t.format as TournamentResponse['format'],
    status: t.status as TournamentResponse['status'],
    maps: JSON.parse(t.maps),
    teamIds: JSON.parse(t.team_ids),
    settings: t.settings ? JSON.parse(t.settings) : {},
    created_at: t.created_at,
    updated_at: t.updated_at ?? t.created_at,
    started_at: t.started_at,
    completed_at: t.completed_at,
    teams: [],
  };

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

  if (!vetoState) {
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
        const cfg = await generateMatchConfig(
          tournament,
          match.team1_id ?? undefined,
          match.team2_id ?? undefined,
          matchSlug
        );
        await db.updateAsync('matches', { config: JSON.stringify(cfg) }, 'slug = ?', [
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
            const result = await matchAllocationService.allocateSingleMatch(matchSlug, baseUrl);
            if (result.success) {
              log.success(
                `[VETO-SIM] Match ${matchSlug} loaded on server ${result.serverId} after automated veto`
              );
            } else {
              log.warn(
                `[VETO-SIM] Failed to allocate server for match ${matchSlug} after automated veto: ${result.error}`
              );
              matchAllocationService.startPollingForServer(matchSlug, baseUrl);
            }
          } catch (err) {
            log.error(
              `[VETO-SIM] Error loading match after automated veto for ${matchSlug}`,
              err as Error
            );
            matchAllocationService.startPollingForServer(matchSlug, baseUrl);
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


