/**
 * The custom stat values that stand for a match, read back (3.0 phase D, PR D8).
 *
 * Shown to the two captains and to an admin, which is exactly who
 * `GET /api/game/manual/matches/:slug` answers for. It matters most before the
 * decision it belongs to: a captain asked to confirm a result should see the
 * numbers filed with it, and an admin ruling on a dispute should see what the
 * argument is actually about.
 *
 * Grouped by field, then by side, in the order the fields are shown — the same
 * order the form asks for them in, so the two read alike.
 */

import { Box, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { MatchReportView, MatchStatValue, ReportSide } from '../api';

interface RecordedStatsProps {
  view: MatchReportView;
  testId?: string;
}

export function RecordedStats({ view, testId = 'manual-report-recorded-stats' }: RecordedStatsProps) {
  const { t } = useTranslation();
  const values = view.stats ?? [];
  if (values.length === 0) return null;

  const unknownTeam = t('manualReport.unknownTeam');
  const teamName = (side: ReportSide | null) =>
    side ? view.match[side].name || unknownTeam : unknownTeam;

  // Keyed on the field, in the order the values already arrive in (the API
  // orders them by the fields' display order).
  const byField = new Map<string, { label: string; values: MatchStatValue[] }>();
  for (const value of values) {
    const entry = byField.get(value.key) ?? { label: value.label, values: [] };
    entry.values.push(value);
    byField.set(value.key, entry);
  }

  return (
    <Box mt={2} data-testid={testId}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t('manualReport.stats.recorded')}
      </Typography>
      <Stack spacing={1}>
        {[...byField.entries()].map(([key, entry]) => (
          <Box key={key}>
            <Typography variant="caption" color="text.secondary">
              {entry.label}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.75} mt={0.25}>
              {entry.values.map((value, index) => (
                <Chip
                  key={`${key}-${value.playerUid ?? value.team}-${value.mapNumber}-${index}`}
                  size="small"
                  variant="outlined"
                  data-testid={`${testId}-${key}-${value.playerUid ?? value.team ?? 'x'}`}
                  label={t('manualReport.stats.value', {
                    subject:
                      value.scope === 'player'
                        ? value.playerName || value.playerId || t('manualReport.captains.unknown')
                        : teamName(value.team),
                    value: value.value ?? '',
                    ...(value.mapNumber > 0
                      ? { suffix: ` (${t('manualReport.game', { number: value.mapNumber })})` }
                      : { suffix: '' }),
                  })}
                />
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
