/**
 * A manually reported tournament's statistics, on the public leaderboard page
 * (3.0 phase D, PR D10).
 *
 * The page's own columns are kills, ADR and the rest, which this game never
 * produced. What it does have are the fields the tournament asked reporters
 * for (D5) and the values filed against them (D6) — goals and saves in Rocket
 * League, laps in Trackmania — added up per player and per team by
 * `GET /api/game/manual/tournaments/:id/stats`.
 *
 * Only confirmed reports count, which is that endpoint's rule, not this
 * component's: a number one captain typed in ten minutes ago and the other has
 * not agreed to is not a tournament statistic yet.
 *
 * Nothing at all is rendered when the tournament asks for no fields. That is
 * the honest answer — a manually reported tournament with no custom fields has
 * a score and nothing else — and it is better than a heading over an empty
 * table.
 */

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import {
  manualReportApi,
  type CustomStatField,
  type StatTotal,
  type TournamentStats,
} from '../api';
import type { TournamentStatsViewProps } from '../../types';

/** A text field is listed, not added up; everything else shows its total. */
function cellText(total: StatTotal | undefined, dash: string): string {
  if (!total || total.count === 0) return dash;
  if (total.valueType === 'text') return (total.texts ?? []).join(', ') || dash;
  return String(total.total ?? dash);
}

export function CustomStatsTables({ tournamentId }: TournamentStatsViewProps) {
  const { t } = useModuleTranslation('manual-report');
  const [stats, setStats] = useState<TournamentStats | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await manualReportApi.tournamentStats(tournamentId);
      if (live && result.ok && result.data) setStats(result.data);
    })();
    return () => {
      live = false;
    };
  }, [tournamentId]);

  if (!stats || stats.fields.length === 0) return null;

  const playerFields = stats.fields.filter((field) => field.scope === 'player');
  const teamFields = stats.fields.filter((field) => field.scope === 'team');
  const hasPlayers = playerFields.length > 0 && stats.players.length > 0;
  const hasTeams = teamFields.length > 0 && stats.teams.length > 0;
  if (!hasPlayers && !hasTeams) return null;

  return (
    <Card sx={{ mb: 3 }} data-testid="manual-report-tournament-stats">
      <CardContent>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          {t('manualReport.stats.tournamentTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('manualReport.stats.tournamentHelp')}
        </Typography>

        {hasTeams && (
          <StatsTable
            caption={t('manualReport.stats.byTeam')}
            subject={t('manualReport.stats.team')}
            fields={teamFields}
            testId="manual-report-team-stats"
            rows={stats.teams.map((team) => ({
              key: team.id,
              name: team.name ?? team.id,
              matches: team.matches,
              totals: team.totals,
            }))}
          />
        )}

        {hasPlayers && (
          <StatsTable
            caption={t('manualReport.stats.byPlayer')}
            subject={t('manualReport.stats.player')}
            fields={playerFields}
            testId="manual-report-player-stats"
            rows={stats.players.map((player) => ({
              key: player.uid,
              name: player.name ?? player.playerId ?? player.uid,
              matches: player.matches,
              totals: player.totals,
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface StatsRow {
  key: string;
  name: string;
  matches: number;
  totals: StatTotal[];
}

function StatsTable({
  caption,
  subject,
  fields,
  rows,
  testId,
}: {
  caption: string;
  subject: string;
  fields: CustomStatField[];
  rows: StatsRow[];
  testId: string;
}) {
  const { t } = useModuleTranslation('manual-report');
  const dash = '—';

  return (
    <TableContainer sx={{ mb: 2 }}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {caption}
      </Typography>
      <Table size="small" data-testid={testId}>
        <TableHead>
          <TableRow>
            <TableCell>{subject}</TableCell>
            <TableCell align="right">{t('manualReport.stats.matches')}</TableCell>
            {fields.map((field) => (
              <TableCell key={field.key} align="right">
                {field.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const byKey = new Map(row.totals.map((total) => [total.key, total]));
            return (
              <TableRow key={row.key} data-testid={`${testId}-row`}>
                <TableCell>{row.name}</TableCell>
                <TableCell align="right">{row.matches}</TableCell>
                {fields.map((field) => (
                  <TableCell key={field.key} align="right">
                    {cellText(byKey.get(field.key), dash)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
