import React from 'react';
import { Box, Typography } from '@mui/material';
import { Row, RowList, SectionHead } from '../common/ui';
import { tokens } from '../../theme/tokens';
import { KindDot } from './NeedsYouQueue';
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
    <Box component="section" mt={6} data-testid="manage-recent" aria-labelledby="manage-recent-heading">
      <SectionHead
        id="manage-recent-heading"
        title={t('managePage.recent.heading')}
        link={{ to: '/matches', label: t('managePage.recent.viewAll') }}
      />

      {events.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('managePage.recent.empty')}
        </Typography>
      ) : (
        <RowList>
          {events.map((event) => (
            <Row key={event.id} columns="auto minmax(0, 1fr)">
              <KindDot color={tokens.color.muted} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body1" fontWeight={600}>
                  {event.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {event.detail ? `${event.detail} · ` : ''}
                  {relativeTime(event.timestamp, t)}
                </Typography>
              </Box>
            </Row>
          ))}
        </RowList>
      )}

      <Typography variant="body2" color="text.secondary" mt={1.5}>
        {t('managePage.recent.closingLine')}
      </Typography>
    </Box>
  );
};
