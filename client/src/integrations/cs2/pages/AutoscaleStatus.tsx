/** What each host's autoscaler reports: its cards, what runs on them, why there's no room. */
import { Paper, Stack, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';

export interface AutoscaleReport {
  host: string;
  jobsWaiting: number;
  cards: { bus: string; recorders: string[]; blocked: '' | 'limit' | 'full' | 'memory' }[];
  standby: string[];
}

export function AutoscaleStatus({ reports }: { reports: AutoscaleReport[] }) {
  const { t } = useModuleTranslation('cs2');
  if (reports.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="recorder-autoscale">
      <Typography variant="subtitle2">{t('highlightsAdmin.fleet.autoscale.title')}</Typography>
      {reports.map((report) => (
        <Stack key={report.host} spacing={0.5} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {report.host} ·{' '}
            {t('highlightsAdmin.fleet.autoscale.waiting', { count: report.jobsWaiting })}
          </Typography>
          {report.cards.map((card) => (
            <Typography key={card.bus} variant="body2">
              {card.bus}: {card.recorders.join(', ') || '–'}
              {card.blocked && ` · ${t(`highlightsAdmin.fleet.autoscale.${card.blocked}`)}`}
            </Typography>
          ))}
        </Stack>
      ))}
    </Paper>
  );
}
