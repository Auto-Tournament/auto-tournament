import React, { useEffect, useState } from 'react';
import { Box, Paper, Typography, Chip, Grid, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ManageResourcesProps } from '../../types';
import { api, getBracketMatchLabel, links, useModuleTranslation } from '../../../module-sdk';
import type { ServerAllocationInfo } from '../cs2.types';
import { useServerAvailability } from './useServerAvailability';

/** The two team names of a match, for a server running one with no bracket label. */
type TeamNames = { team1?: string; team2?: string };

/**
 * The team names of the matches the servers are running, asked per match the
 * first time a server shows one. A match keeps its teams while it runs, so an
 * answer is kept for as long as the grid is open.
 */
function useTeamNames(slugs: string[]): Map<string, TeamNames> {
  const [names, setNames] = useState<Map<string, TeamNames>>(() => new Map());
  const missing = slugs.filter((slug) => !names.has(slug));
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    void Promise.all(
      missingKey.split(',').map(async (slug): Promise<[string, TeamNames]> => {
        try {
          const res = await api.get<{
            match?: { team1?: { name?: string } | null; team2?: { name?: string } | null };
          }>(`/api/matches/${encodeURIComponent(slug)}`);
          return [slug, { team1: res.match?.team1?.name, team2: res.match?.team2?.name }];
        } catch {
          return [slug, {}];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setNames((prev) => {
        const next = new Map(prev);
        for (const [slug, teams] of entries) next.set(slug, teams);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  return names;
}

/**
 * The Manage console's server grid (`dashboardWidgets.manageResources`). It
 * asks the fleet itself on the console's 5-second cadence, and the team names
 * of what runs on it (client API 0.2.0): the console hands it only the
 * tournament.
 */
export const ServerGrid: React.FC<ManageResourcesProps> = () => {
  const { availability } = useServerAvailability(5000);
  const servers = availability?.servers ?? [];
  const teamNames = useTeamNames(
    servers.filter((s) => !bracketLabel(s)).flatMap((s) => (s.matchSlug ? [s.matchSlug] : []))
  );
  return <ServerGridView servers={servers} teamNames={teamNames} />;
};

/** "UB R1 M1" for a double-elimination match; null for one the bracket does not label. */
function bracketLabel(server: ServerAllocationInfo): string | null {
  if (!server.matchSlug || server.matchRound === null) return null;
  return getBracketMatchLabel({
    slug: server.matchSlug,
    bracket: server.matchBracket ?? null,
    round: server.matchRound ?? 0,
    matchNumber: server.matchNumber ?? 0,
  });
}

function timeAgo(unixSeconds: number | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!unixSeconds) return t('managePage.servers.never');
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return t('managePage.needsYou.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('managePage.needsYou.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t('managePage.needsYou.hoursAgo', { count: hours });
}

/**
 * Server grid using the same server-availability data Matches.tsx already
 * polls. Offline servers are highlighted with an error-coloured border.
 */
const ServerGridView: React.FC<{
  servers: ServerAllocationInfo[];
  teamNames: Map<string, TeamNames>;
}> = ({ servers, teamNames }) => {
  const { t } = useModuleTranslation('cs2');

  return (
    <Box component="section" mt={4} data-testid="manage-servers">
      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
        <Typography variant="h6" fontWeight={600}>
          {t('managePage.servers.heading')}
        </Typography>
        <MuiLink component={RouterLink} to={links.servers()} variant="body2" color="text.secondary">
          {t('managePage.servers.viewAll')}
        </MuiLink>
      </Box>

      {servers.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('managePage.servers.none')}
        </Typography>
      ) : (
        <Grid container spacing={1.5}>
          {servers.map((server) => {
            const match = server.matchSlug ? teamNames.get(server.matchSlug) : undefined;
            const matchLabel =
              server.matchSlug &&
              (bracketLabel(server) ||
                (match?.team1 && match?.team2
                  ? t('managePage.needsYou.vsLabel', {
                      team1: match.team1,
                      team2: match.team2,
                    })
                  : server.matchSlug));

            return (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={server.id}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: !server.online ? 'error.main' : 'divider',
                    height: '100%',
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {server.name}
                    </Typography>
                    <Chip
                      label={
                        !server.online
                          ? t('managePage.servers.offline')
                          : server.allocatable
                          ? t('managePage.servers.free')
                          : t('managePage.servers.inMatch')
                      }
                      size="small"
                      color={!server.online ? 'error' : server.allocatable ? 'success' : 'info'}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {!server.online
                      ? t('managePage.servers.lastHeartbeat', {
                          time: timeAgo(server.updatedAt, t),
                        })
                      : matchLabel || t('managePage.servers.free')}
                  </Typography>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
};
