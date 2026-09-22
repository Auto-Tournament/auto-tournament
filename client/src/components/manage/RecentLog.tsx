import React from 'react';
import { Box, Paper, List, ListItem, Typography, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RecentEvent } from '../../utils/manageSelectors';

interface RecentLogProps {
  events: RecentEvent[];
}

function relativeTime(unixSeconds: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return t('managePage.needsYou.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('managePage.needsYou.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t('managePage.needsYou.hoursAgo', { count: hours });
}

/**
 * The last ~8 meaningful events (map results, series completions), derived
 * from matches already on the page. Closes with the same reassurance line
 * as the design: the healthy state stays quiet.
 */
export const RecentLog: React.FC<RecentLogProps> = ({ events }) => {
  const { t } = useTranslation();

  return (
    <Box component="section" mt={4} data-testid="manage-recent">
      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
        <Typography variant="h6" fontWeight={600}>
          {t('managePage.recent.heading')}
        </Typography>
        <MuiLink component={RouterLink} to="/matches" variant="body2" color="text.secondary">
          {t('managePage.recent.viewAll')}
        </MuiLink>
      </Box>

      {events.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('managePage.recent.empty')}
        </Typography>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {events.map((event, index) => (
              <ListItem key={event.id} divider={index < events.length - 1}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {event.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {event.detail ? `${event.detail} · ` : ''}
                    {relativeTime(event.timestamp, t)}
                  </Typography>
                </Box>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <Typography variant="body2" color="text.secondary" mt={1.5}>
        {t('managePage.recent.closingLine')}
      </Typography>
    </Box>
  );
};
