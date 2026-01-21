import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { log } from '../utils/logger';
import packageJson from '../../package.json';

const router = Router();

// Public version endpoint
router.get('/version', async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    version: packageJson.version,
  });
});

router.use(requireAuth);

const mapSettingsResponse = async () => {
  const webhookUrl = await settingsService.getWebhookUrl();
  const steamApiKey = await settingsService.getSteamApiKey();
  const defaultPlayerElo = null;
  const simulateMatches = await settingsService.isSimulationModeEnabled();
  const simulationTimescale = await settingsService.getSimulationTimescale();
  const matchzyChatPrefix = await settingsService.getMatchzyChatPrefix();
  const matchzyAdminChatPrefix = await settingsService.getMatchzyAdminChatPrefix();
  const matchzyKnifeEnabledDefault = await settingsService.isKnifeRoundEnabledByDefault();
  const ratingsEnabled = await settingsService.areRatingsEnabled();
  const matchzyDebugChatEnabled = await settingsService.isMatchzyDebugChatEnabled();
  const allowSelfRegister = await settingsService.isSelfRegistrationAllowed();
  
  // MatchZy Enhanced v1.3.0 settings
  const matchzyEnhanced = await settingsService.getMatchzyEnhancedSettings();

  return {
    webhookUrl,
    steamApiKey: null,
    steamApiKeySet: Boolean(steamApiKey),
    webhookConfigured: Boolean(webhookUrl),
    defaultPlayerElo,
    simulateMatches,
    simulationTimescale,
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    ratingsEnabled,
    matchzyDebugChatEnabled,
    allowSelfRegister,
    // MatchZy Enhanced v1.3.0 settings (null = use tournament defaults)
    matchzyAutoreadyEnabled: matchzyEnhanced.matchzy_autoready_enabled,
    matchzyBothTeamsUnpauseRequired: matchzyEnhanced.matchzy_both_teams_unpause_required,
    matchzyMaxPausesPerTeam: matchzyEnhanced.matchzy_max_pauses_per_team,
    matchzyPauseDuration: matchzyEnhanced.matchzy_pause_duration,
    matchzySideSelectionEnabled: matchzyEnhanced.matchzy_side_selection_enabled,
    matchzySideSelectionTime: matchzyEnhanced.matchzy_side_selection_time,
    matchzyGgEnabled: matchzyEnhanced.matchzy_gg_enabled,
    matchzyGgThreshold: matchzyEnhanced.matchzy_gg_threshold,
    matchzyGgMinScoreDiff: matchzyEnhanced.matchzy_gg_min_score_diff,
    matchzyFfwEnabled: matchzyEnhanced.matchzy_ffw_enabled,
    matchzyFfwTime: matchzyEnhanced.matchzy_ffw_time,
    matchzyDemoRecordingEnabled: matchzyEnhanced.matchzy_demo_recording_enabled,
  };
};

router.get('/', async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    settings: await mapSettingsResponse(),
  });
});

router.put('/', async (req: Request, res: Response) => {
  const {
    webhookUrl,
    simulateMatches,
    simulationTimescale,
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    ratingsEnabled,
    matchzyDebugChatEnabled,
    allowSelfRegister,
    // MatchZy Enhanced v1.3.0 settings
    matchzyAutoreadyEnabled,
    matchzyBothTeamsUnpauseRequired,
    matchzyMaxPausesPerTeam,
    matchzyPauseDuration,
    matchzySideSelectionEnabled,
    matchzySideSelectionTime,
    matchzyGgEnabled,
    matchzyGgThreshold,
    matchzyGgMinScoreDiff,
    matchzyFfwEnabled,
    matchzyFfwTime,
    matchzyDemoRecordingEnabled,
  } = req.body as {
    webhookUrl?: unknown;
    simulateMatches?: unknown;
    simulationTimescale?: unknown;
    matchzyChatPrefix?: unknown;
    matchzyAdminChatPrefix?: unknown;
    matchzyKnifeEnabledDefault?: unknown;
    ratingsEnabled?: unknown;
    matchzyDebugChatEnabled?: unknown;
    allowSelfRegister?: unknown;
    // MatchZy Enhanced v1.3.0 settings
    matchzyAutoreadyEnabled?: unknown;
    matchzyBothTeamsUnpauseRequired?: unknown;
    matchzyMaxPausesPerTeam?: unknown;
    matchzyPauseDuration?: unknown;
    matchzySideSelectionEnabled?: unknown;
    matchzySideSelectionTime?: unknown;
    matchzyGgEnabled?: unknown;
    matchzyGgThreshold?: unknown;
    matchzyGgMinScoreDiff?: unknown;
    matchzyFfwEnabled?: unknown;
    matchzyFfwTime?: unknown;
    matchzyDemoRecordingEnabled?: unknown;
  };

  try {
    if (webhookUrl !== undefined) {
      if (typeof webhookUrl !== 'string' && webhookUrl !== null) {
        return res.status(400).json({
          success: false,
          error: 'webhookUrl must be a string or null',
        });
      }
      await settingsService.setSetting(
        'webhook_url',
        typeof webhookUrl === 'string' ? webhookUrl : null
      );
    }

    if (simulateMatches !== undefined) {
      // This is a **developer-only** option – ignore it completely in production.
      if (process.env.NODE_ENV === 'production') {
        log.warn(
          'Received simulateMatches setting update in production environment – ignoring for safety'
        );
      } else {
        if (typeof simulateMatches !== 'boolean' && simulateMatches !== null) {
          return res.status(400).json({
            success: false,
            error: 'simulateMatches must be a boolean or null',
          });
        }

        const value =
          simulateMatches === null ? null : simulateMatches === true ? '1' : '0';

        await settingsService.setSetting('simulate_matches', value);
      }
    }

    if (simulationTimescale !== undefined) {
      if (typeof simulationTimescale !== 'number' && simulationTimescale !== null) {
        return res.status(400).json({
          success: false,
          error: 'simulationTimescale must be a number or null',
        });
      }

      let value: string | null = null;
      if (typeof simulationTimescale === 'number' && Number.isFinite(simulationTimescale)) {
        const clamped = Math.min(4, Math.max(0.1, simulationTimescale));
        value = String(clamped);
      }

      await settingsService.setSetting('simulation_timescale', value);
    }

    if (matchzyChatPrefix !== undefined) {
      if (typeof matchzyChatPrefix !== 'string' && matchzyChatPrefix !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyChatPrefix must be a string or null',
        });
      }

      await settingsService.setSetting(
        'matchzy_chat_prefix',
        typeof matchzyChatPrefix === 'string' ? matchzyChatPrefix : null
      );
    }

    if (matchzyAdminChatPrefix !== undefined) {
      if (typeof matchzyAdminChatPrefix !== 'string' && matchzyAdminChatPrefix !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyAdminChatPrefix must be a string or null',
        });
      }

      await settingsService.setSetting(
        'matchzy_admin_chat_prefix',
        typeof matchzyAdminChatPrefix === 'string' ? matchzyAdminChatPrefix : null
      );
    }

    if (matchzyKnifeEnabledDefault !== undefined) {
      if (typeof matchzyKnifeEnabledDefault !== 'boolean' && matchzyKnifeEnabledDefault !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyKnifeEnabledDefault must be a boolean or null',
        });
      }

      const value =
        matchzyKnifeEnabledDefault === null
          ? null
          : matchzyKnifeEnabledDefault === true
          ? '1'
          : '0';

      await settingsService.setSetting('matchzy_knife_enabled_default', value);
    }

    if (ratingsEnabled !== undefined) {
      if (typeof ratingsEnabled !== 'boolean' && ratingsEnabled !== null) {
        return res.status(400).json({
          success: false,
          error: 'ratingsEnabled must be a boolean or null',
        });
      }

      const value =
        ratingsEnabled === null ? null : ratingsEnabled === true ? '1' : '0';

      await settingsService.setSetting('ratings_enabled', value);
    }

    if (matchzyDebugChatEnabled !== undefined) {
      if (typeof matchzyDebugChatEnabled !== 'boolean' && matchzyDebugChatEnabled !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyDebugChatEnabled must be a boolean or null',
        });
      }

      const value =
        matchzyDebugChatEnabled === null
          ? null
          : matchzyDebugChatEnabled === true
          ? '1'
          : '0';

      await settingsService.setSetting('matchzy_debug_chat', value);
    }

    if (allowSelfRegister !== undefined) {
      if (typeof allowSelfRegister !== 'boolean' && allowSelfRegister !== null) {
        return res.status(400).json({
          success: false,
          error: 'allowSelfRegister must be a boolean or null',
        });
      }

      const value =
        allowSelfRegister === null ? null : allowSelfRegister === true ? '1' : '0';

      await settingsService.setSetting('allow_self_register', value);
    }

    // MatchZy Enhanced v1.3.0 settings
    if (matchzyAutoreadyEnabled !== undefined) {
      if (
        typeof matchzyAutoreadyEnabled !== 'number' &&
        typeof matchzyAutoreadyEnabled !== 'boolean' &&
        matchzyAutoreadyEnabled !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzyAutoreadyEnabled must be 0, 1, boolean, or null',
        });
      }
      const value =
        matchzyAutoreadyEnabled === null
          ? null
          : matchzyAutoreadyEnabled === true || matchzyAutoreadyEnabled === 1
          ? '1'
          : '0';
      await settingsService.setSetting('matchzy_autoready_enabled', value);
    }

    if (matchzyBothTeamsUnpauseRequired !== undefined) {
      if (
        typeof matchzyBothTeamsUnpauseRequired !== 'number' &&
        typeof matchzyBothTeamsUnpauseRequired !== 'boolean' &&
        matchzyBothTeamsUnpauseRequired !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzyBothTeamsUnpauseRequired must be 0, 1, boolean, or null',
        });
      }
      const value =
        matchzyBothTeamsUnpauseRequired === null
          ? null
          : matchzyBothTeamsUnpauseRequired === true || matchzyBothTeamsUnpauseRequired === 1
          ? '1'
          : '0';
      await settingsService.setSetting('matchzy_both_teams_unpause_required', value);
    }

    if (matchzyMaxPausesPerTeam !== undefined) {
      if (
        typeof matchzyMaxPausesPerTeam !== 'number' &&
        matchzyMaxPausesPerTeam !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzyMaxPausesPerTeam must be a number or null',
        });
      }
      await settingsService.setSetting(
        'matchzy_max_pauses_per_team',
        matchzyMaxPausesPerTeam === null ? null : String(matchzyMaxPausesPerTeam)
      );
    }

    if (matchzyPauseDuration !== undefined) {
      if (typeof matchzyPauseDuration !== 'number' && matchzyPauseDuration !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyPauseDuration must be a number or null',
        });
      }
      await settingsService.setSetting(
        'matchzy_pause_duration',
        matchzyPauseDuration === null ? null : String(matchzyPauseDuration)
      );
    }

    if (matchzySideSelectionEnabled !== undefined) {
      if (
        typeof matchzySideSelectionEnabled !== 'number' &&
        typeof matchzySideSelectionEnabled !== 'boolean' &&
        matchzySideSelectionEnabled !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzySideSelectionEnabled must be 0, 1, boolean, or null',
        });
      }
      const value =
        matchzySideSelectionEnabled === null
          ? null
          : matchzySideSelectionEnabled === true || matchzySideSelectionEnabled === 1
          ? '1'
          : '0';
      await settingsService.setSetting('matchzy_side_selection_enabled', value);
    }

    if (matchzySideSelectionTime !== undefined) {
      if (
        typeof matchzySideSelectionTime !== 'number' &&
        matchzySideSelectionTime !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzySideSelectionTime must be a number or null',
        });
      }
      await settingsService.setSetting(
        'matchzy_side_selection_time',
        matchzySideSelectionTime === null ? null : String(matchzySideSelectionTime)
      );
    }

    if (matchzyGgEnabled !== undefined) {
      if (
        typeof matchzyGgEnabled !== 'number' &&
        typeof matchzyGgEnabled !== 'boolean' &&
        matchzyGgEnabled !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzyGgEnabled must be 0, 1, boolean, or null',
        });
      }
      const value =
        matchzyGgEnabled === null
          ? null
          : matchzyGgEnabled === true || matchzyGgEnabled === 1
          ? '1'
          : '0';
      await settingsService.setSetting('matchzy_gg_enabled', value);
    }

    if (matchzyGgThreshold !== undefined) {
      if (typeof matchzyGgThreshold !== 'number' && matchzyGgThreshold !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyGgThreshold must be a number (0.0-1.0) or null',
        });
      }
      await settingsService.setSetting(
        'matchzy_gg_threshold',
        matchzyGgThreshold === null ? null : String(matchzyGgThreshold)
      );
    }

    if (matchzyGgMinScoreDiff !== undefined) {
      if (typeof matchzyGgMinScoreDiff !== 'number' && matchzyGgMinScoreDiff !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyGgMinScoreDiff must be a number (0-16) or null',
        });
      }
      await settingsService.setSetting(
        'matchzy_gg_min_score_diff',
        matchzyGgMinScoreDiff === null ? null : String(matchzyGgMinScoreDiff)
      );
    }

    if (matchzyFfwEnabled !== undefined) {
      if (
        typeof matchzyFfwEnabled !== 'number' &&
        typeof matchzyFfwEnabled !== 'boolean' &&
        matchzyFfwEnabled !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzyFfwEnabled must be 0, 1, boolean, or null',
        });
      }
      const value =
        matchzyFfwEnabled === null
          ? null
          : matchzyFfwEnabled === true || matchzyFfwEnabled === 1
          ? '1'
          : '0';
      await settingsService.setSetting('matchzy_ffw_enabled', value);
    }

    if (matchzyFfwTime !== undefined) {
      if (typeof matchzyFfwTime !== 'number' && matchzyFfwTime !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyFfwTime must be a number or null',
        });
      }
      await settingsService.setSetting(
        'matchzy_ffw_time',
        matchzyFfwTime === null ? null : String(matchzyFfwTime)
      );
    }

    if (matchzyDemoRecordingEnabled !== undefined) {
      if (
        typeof matchzyDemoRecordingEnabled !== 'number' &&
        typeof matchzyDemoRecordingEnabled !== 'boolean' &&
        matchzyDemoRecordingEnabled !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'matchzyDemoRecordingEnabled must be 0, 1, boolean, or null',
        });
      }
      const value =
        matchzyDemoRecordingEnabled === null
          ? null
          : matchzyDemoRecordingEnabled === true || matchzyDemoRecordingEnabled === 1
          ? '1'
          : '0';
      await settingsService.setSetting('matchzy_demo_recording_enabled', value);
    }

    return res.json({
      success: true,
      settings: await mapSettingsResponse(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update settings';
    log.error('Failed to update settings', error);
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

export default router;

