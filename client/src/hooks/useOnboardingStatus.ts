import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

interface OnboardingStatus {
  hasServers: boolean;
  hasWebhookUrl: boolean;
  hasTeams: boolean;
  hasTournament: boolean;
  tournamentStatus: 'none' | 'setup' | 'ready' | 'in_progress' | 'completed';
  serversCount: number;
  teamsCount: number;
  loading: boolean;
}

interface TournamentResponse {
  success: boolean;
  tournament?: {
    status: 'setup' | 'ready' | 'in_progress' | 'completed';
  };
}

export const useOnboardingStatus = () => {
  const [status, setStatus] = useState<OnboardingStatus>({
    hasServers: false,
    hasWebhookUrl: false,
    hasTeams: false,
    hasTournament: false,
    tournamentStatus: 'none',
    serversCount: 0,
    teamsCount: 0,
    loading: true,
  });

  const loadStatus = useCallback(async () => {
    setStatus((prev) => ({ ...prev, loading: true }));

    try {
      // Load servers
      const serversResponse: { servers: unknown[] } = await api.get('/api/servers');
      const servers = serversResponse.servers || [];

      // Load teams
      const teamsResponse: { teams: unknown[] } = await api.get('/api/teams');
      const teams = teamsResponse.teams || [];

      // Load settings
      let hasWebhookUrl = false;
      try {
        const settingsResponse: { settings: { webhookConfigured: boolean } } = await api.get(
          '/api/settings'
        );
        hasWebhookUrl = Boolean(settingsResponse.settings?.webhookConfigured);
      } catch (settingsError) {
        console.error('Failed to load settings status:', settingsError);
      }

      // Try to load tournament
      let tournamentStatus: 'none' | 'setup' | 'ready' | 'in_progress' | 'completed' = 'none';
      try {
        const tournamentResponse: TournamentResponse = await api.get('/api/tournament');
        if (tournamentResponse.success && tournamentResponse.tournament) {
          tournamentStatus = tournamentResponse.tournament.status;
        }
      } catch {
        // No tournament exists
        tournamentStatus = 'none';
      }

      setStatus({
        hasServers: servers.length > 0,
        hasWebhookUrl,
        hasTeams: teams.length >= 2,
        hasTournament: tournamentStatus !== 'none',
        tournamentStatus,
        serversCount: servers.length,
        teamsCount: teams.length,
        loading: false,
      });
    } catch (error) {
      console.error('Failed to load onboarding status:', error);
      setStatus((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  return { ...status, refresh: loadStatus };
};
