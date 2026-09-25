import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Panel, SectionHead } from '../common/ui';
import { paths } from '../../paths';
import { tokens, textSize } from '../../theme/tokens';

const { color } = tokens;

interface PeopleOverviewCardProps {
  playersCount: number;
  signedInThisWeekCount: number;
  adminsCount: number;
}

/**
 * Right-column "People" summary (the draft's `.kv` panel): players, who
 * signed in this week, and admins, all counted off GET /api/players (the
 * admin mapping carries `isAdmin` and `lastSignInAt`). The draft's "Game
 * accounts waiting for approval" is left out: there is no approval step for
 * a game account to wait in.
 */
export function PeopleOverviewCard({ playersCount, signedInThisWeekCount, adminsCount }: PeopleOverviewCardProps) {
  const { t } = useTranslation();
  const lines = [
    { key: 'players', label: t('dashboard.people.players'), value: playersCount },
    { key: 'signedInThisWeek', label: t('dashboard.people.signedInThisWeek'), value: signedInThisWeekCount },
    { key: 'admins', label: t('dashboard.people.admins'), value: adminsCount },
  ];

  return (
    <Panel
      component="section"
      aria-labelledby="admin-home-people-title"
      data-testid="admin-home-people-card"
      sx={{ p: 3, display: 'grid', gap: 1.5 }}
    >
      <SectionHead
        level={3}
        id="admin-home-people-title"
        title={t('dashboard.people.title')}
        link={{ to: paths.players, label: t('dashboard.people.open') }}
        sx={{ mb: 0 }}
      />
      <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1 }}>
        {lines.map((line) => (
          <Box
            key={line.key}
            data-testid={`admin-home-people-${line.key}`}
            sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: textSize.sm }}
          >
            <Box component="dt" sx={{ color: color.ink2 }}>
              {line.label}
            </Box>
            <Box component="dd" sx={{ m: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {line.value}
            </Box>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}
