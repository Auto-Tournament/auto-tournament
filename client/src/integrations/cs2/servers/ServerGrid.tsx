import React from 'react';
import { Box, Paper, Typography, Chip, Grid, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ManageResourcesProps as ServerGridProps } from '../../types';
import { paths } from '../../../paths';
import { getBracketMatchLabel, useModuleTranslation } from '../../../module-sdk';

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
export const ServerGrid: React.FC<ServerGridProps> = ({ servers, matches }) => {
  const { t } = useModuleTranslation('cs2');
  const bySlug = new Map(matches.map((m) => [m.slug, m]));

  return (
    <Box component="section" mt={4} data-testid="manage-servers">
      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
        <Typography variant="h6" fontWeight={600}>
          {t('managePage.servers.heading')}
        </Typography>
        <MuiLink component={RouterLink} to={paths.servers} variant="body2" color="text.secondary">
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
            const match = server.matchSlug ? bySlug.get(server.matchSlug) : undefined;
            const matchLabel =
              server.matchSlug &&
              ((server.matchRound !== null &&
                getBracketMatchLabel({
                  slug: server.matchSlug,
                  bracket: server.matchBracket ?? null,
                  round: server.matchRound ?? 0,
                  matchNumber: server.matchNumber ?? 0,
                })) ||
                (match?.team1?.name && match?.team2?.name
                  ? t('managePage.needsYou.vsLabel', {
                      team1: match.team1.name,
                      team2: match.team2.name,
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
