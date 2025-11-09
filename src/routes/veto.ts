import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitVetoUpdate } from '../services/socketService';
import { matchAllocationService } from '../services/matchAllocationService';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';
import { generateMatchConfig } from '../services/matchConfigGenerator';
import { getVetoOrder } from '../utils/vetoConfig';

const router = Router();

/**
 * GET /api/veto/:matchSlug
 * Get current veto state for a match
 */
router.get('/:matchSlug', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found',
      });
    }

    // Get teams (id is the slug)
    const team1 = db.queryOne<{ name: string; id: string }>(
      'SELECT name, id FROM teams WHERE id = ?',
      [match.team1_id]
    );
    const team2 = db.queryOne<{ name: string; id: string }>(
      'SELECT name, id FROM teams WHERE id = ?',
      [match.team2_id]
    );

    // Get tournament to determine format
    const tournament = db.queryOne<{ format: string; maps: string }>(
      'SELECT format, maps FROM tournament WHERE id = ?',
      [match.tournament_id]
    );

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: 'Tournament not found',
      });
    }

    const format = tournament.format as 'bo1' | 'bo3' | 'bo5';
    const tournamentMaps = JSON.parse(tournament.maps);

    // Parse existing veto state or create new one
    let vetoState = match.veto_state ? JSON.parse(match.veto_state) : null;

    if (!vetoState) {
      // Initialize veto state
      const vetoOrder = getVetoOrder(format);
      vetoState = {
        matchSlug,
        format,
        status: 'pending',
        currentStep: 1,
        totalSteps: vetoOrder.length,
        availableMaps: [...tournamentMaps],
        bannedMaps: [],
        pickedMaps: [],
        actions: [],
        currentTurn: vetoOrder[0].team,
        currentAction: vetoOrder[0].action,
        team1Id: match.team1_id,
        team2Id: match.team2_id,
        team1Name: team1?.name || 'Team 1',
        team2Name: team2?.name || 'Team 2',
      };
    } else {
      // Update team info in case it changed
      vetoState.team1Id = match.team1_id;
      vetoState.team2Id = match.team2_id;
      vetoState.team1Name = team1?.name || 'Team 1';
      vetoState.team2Name = team2?.name || 'Team 2';
    }

    return res.json({
      success: true,
      veto: vetoState,
    });
  } catch (error) {
    log.error('Error getting veto state', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get veto state',
    });
  }
});

/**
 * POST /api/veto/:matchSlug/action
 * Submit a veto action (ban/pick/side_pick)
 */
router.post('/:matchSlug/action', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const { mapName, side, teamSlug } = req.body;

    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found',
      });
    }

    // Get teams to validate which team is allowed to make this action (id is the slug)
    const team1 = db.queryOne<{ name: string; id: string }>(
      'SELECT name, id FROM teams WHERE id = ?',
      [match.team1_id]
    );
    const team2 = db.queryOne<{ name: string; id: string }>(
      'SELECT name, id FROM teams WHERE id = ?',
      [match.team2_id]
    );

    // Get tournament
    const tournament = db.queryOne<{ format: string; maps: string }>(
      'SELECT format, maps FROM tournament WHERE id = ?',
      [match.tournament_id]
    );

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: 'Tournament not found',
      });
    }

    const format = tournament.format as 'bo1' | 'bo3' | 'bo5';
    const tournamentMaps = JSON.parse(tournament.maps);
    const vetoOrder = getVetoOrder(format);

    // Get current veto state
    let vetoState = match.veto_state ? JSON.parse(match.veto_state) : null;

    if (!vetoState) {
      // Initialize if not exists
      vetoState = {
        matchSlug,
        format,
        status: 'in_progress',
        currentStep: 1,
        totalSteps: vetoOrder.length,
        availableMaps: [...tournamentMaps],
        bannedMaps: [],
        pickedMaps: [],
        actions: [],
        currentTurn: vetoOrder[0].team,
        currentAction: vetoOrder[0].action,
        team1Id: match.team1_id,
        team2Id: match.team2_id,
        team1Name: team1?.name || 'Team 1',
        team2Name: team2?.name || 'Team 2',
      };
    } else {
      // Update team info in case it changed
      vetoState.team1Id = match.team1_id;
      vetoState.team2Id = match.team2_id;
      vetoState.team1Name = team1?.name || 'Team 1';
      vetoState.team2Name = team2?.name || 'Team 2';
    }

    if (vetoState.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Veto already completed',
      });
    }

    const currentStepConfig = vetoOrder[vetoState.currentStep - 1];
    const currentAction = currentStepConfig.action;

    // Security: Validate that the correct team is making this action
    if (teamSlug) {
      const expectedTeam = currentStepConfig.team;
      const actualTeam = teamSlug === team1?.id ? 'team1' : teamSlug === team2?.id ? 'team2' : null;

      if (!actualTeam) {
        return res.status(403).json({
          success: false,
          error: 'Invalid team',
        });
      }

      if (actualTeam !== expectedTeam) {
        return res.status(403).json({
          success: false,
          error: `It's not your turn. Waiting for the other team.`,
        });
      }
    }

    // Validate action
    if (currentAction === 'ban') {
      if (!mapName || !vetoState.availableMaps.includes(mapName)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid map selection',
        });
      }

      // Ban the map
      vetoState.availableMaps = vetoState.availableMaps.filter((m: string) => m !== mapName);
      vetoState.bannedMaps.push(mapName);
      vetoState.actions.push({
        step: vetoState.currentStep,
        team: currentStepConfig.team,
        action: 'ban',
        mapName,
        timestamp: Math.floor(Date.now() / 1000),
      });
    } else if (currentAction === 'pick') {
      if (!mapName || !vetoState.availableMaps.includes(mapName)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid map selection',
        });
      }

      // Pick the map
      const mapNumber = vetoState.pickedMaps.length + 1;
      vetoState.availableMaps = vetoState.availableMaps.filter((m: string) => m !== mapName);
      vetoState.pickedMaps.push({
        mapNumber,
        mapName,
        pickedBy: currentStepConfig.team,
        knifeRound: false, // Will be updated if it's the decider
      });
      vetoState.actions.push({
        step: vetoState.currentStep,
        team: currentStepConfig.team,
        action: 'pick',
        mapName,
        timestamp: Math.floor(Date.now() / 1000),
      });
    } else if (currentAction === 'side_pick') {
      log.debug('Processing side pick', { side, currentAction, teamSlug });

      if (!side || !['CT', 'T'].includes(side)) {
        log.warn('Invalid side selection', { side });
        return res.status(400).json({
          success: false,
          error: 'Invalid side selection',
        });
      }

      // Set side for the last picked map
      const lastPick = vetoState.pickedMaps[vetoState.pickedMaps.length - 1];
      log.debug('Last picked map', { lastPick, pickedMapsCount: vetoState.pickedMaps.length });

      if (lastPick) {
        if (currentStepConfig.team === 'team1') {
          lastPick.sideTeam1 = side;
          lastPick.sideTeam2 = side === 'CT' ? 'T' : 'CT';
        } else {
          lastPick.sideTeam2 = side;
          lastPick.sideTeam1 = side === 'CT' ? 'T' : 'CT';
        }
        log.success(`Side picked for ${lastPick.mapName}`, {
          team: currentStepConfig.team,
          side,
          sideTeam1: lastPick.sideTeam1,
          sideTeam2: lastPick.sideTeam2,
        });
      } else {
        log.error('No map to pick side for');
        return res.status(400).json({
          success: false,
          error: 'No map to pick side for',
        });
      }

      vetoState.actions.push({
        step: vetoState.currentStep,
        team: currentStepConfig.team,
        action: 'side_pick',
        mapName: lastPick?.mapName || 'unknown',
        side,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }

    // Move to next step
    vetoState.currentStep += 1;

    // Check if veto is complete
    if (vetoState.currentStep > vetoState.totalSteps) {
      vetoState.status = 'completed';
      vetoState.completedAt = Math.floor(Date.now() / 1000);

      // Add remaining map as decider (if applicable)
      if (vetoState.availableMaps.length === 1) {
        const deciderMap = vetoState.availableMaps[0];
        vetoState.pickedMaps.push({
          mapNumber: vetoState.pickedMaps.length + 1,
          mapName: deciderMap,
          pickedBy: 'decider',
          knifeRound: true, // Decider map always has knife
        });
        vetoState.availableMaps = [];
      }

      log.success(`🎉 Veto completed for match ${matchSlug}`, {
        pickedMaps: vetoState.pickedMaps.map((m: { mapName: string }) => m.mapName),
      });

      // Update match status to 'ready' now that veto is completed
      db.update('matches', { status: 'ready' }, 'slug = ?', [matchSlug]);
      log.info(`Match ${matchSlug} status updated to 'ready' after veto completion`);

      // NEW: Recompute and persist the fresh config snapshot so /api/matches and any readers of matches.config are in sync
      const t = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
        match.tournament_id,
      ]);
      if (t) {
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
          teams: [], // Not needed for config generation
        };
        try {
          const cfg = await generateMatchConfig(
            tournament,
            match.team1_id ?? undefined,
            match.team2_id ?? undefined,
            matchSlug
          );
          db.update('matches', { config: JSON.stringify(cfg) }, 'slug = ?', [matchSlug]);
          log.success(`Stored fresh config for match ${matchSlug} after veto completion`);
        } catch (e) {
          log.error(`Failed to generate/store config after veto for ${matchSlug}`, e as Error);
        }
      }

      // Automatically allocate server and load match after veto completion (async)
      console.log('\n========================================');
      console.log(`🚀 AUTO-LOADING MATCH AFTER VETO`);
      console.log(`Match: ${matchSlug}`);
      console.log(
        `Picked Maps:`,
        vetoState.pickedMaps.map((m: { mapName: string }) => m.mapName)
      );
      console.log('========================================\n');

      // Use API_URL from environment or construct from standard port
      const baseUrl = process.env.WEBHOOK_URL || 'http://localhost:3001';
      console.log(`Base URL for webhook: ${baseUrl}`);

      setImmediate(async () => {
        try {
          console.log(`[VETO] Calling allocateSingleMatch for ${matchSlug}...`);
          const result = await matchAllocationService.allocateSingleMatch(matchSlug, baseUrl);

          if (result.success) {
            log.success(`✅ Match ${matchSlug} loaded on server ${result.serverId} after veto`);
            console.log(`Server: ${result.serverId}`);
          } else {
            log.error(`❌ Failed to load match ${matchSlug} after veto: ${result.error}`);
            console.error('Allocation error:', result.error);
          }
        } catch (err) {
          log.error(`❌ Error loading match after veto`, err as Error);
          console.error('Exception during allocation:', err);
        }
      });
    } else {
      // Set next step
      const nextStepConfig = vetoOrder[vetoState.currentStep - 1];
      vetoState.currentTurn = nextStepConfig.team;
      vetoState.currentAction = nextStepConfig.action;
    }

    // Save veto state
    db.update('matches', { veto_state: JSON.stringify(vetoState) }, 'slug = ?', [matchSlug]);

    // Emit update via Socket.io
    emitVetoUpdate(matchSlug, vetoState);

    log.debug(`Veto action processed for ${matchSlug}`, {
      step: vetoState.currentStep - 1,
      action: currentAction,
      mapName,
      side,
    });

    return res.json({
      success: true,
      veto: vetoState,
    });
  } catch (error) {
    log.error('Error processing veto action', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process veto action',
    });
  }
});

/**
 * POST /api/veto/:matchSlug/reset
 * Reset veto state (admin only in future)
 */
router.post('/:matchSlug/reset', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    db.update('matches', { veto_state: null }, 'slug = ?', [matchSlug]);

    log.info(`Veto reset for match ${matchSlug}`);

    emitVetoUpdate(matchSlug, null);

    return res.json({
      success: true,
      message: 'Veto reset successfully',
    });
  } catch (error) {
    log.error('Error resetting veto', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reset veto',
    });
  }
});

export default router;
