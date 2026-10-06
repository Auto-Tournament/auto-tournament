/**
 * The teams in a saved tournament, on the setup's "Teams and sign-up" step:
 * the ones that signed themselves up (with their lineup and check-in) and the
 * ones the organizer added, each with Remove. Read from the public sign-up
 * list (`/api/tournament-signup/:id`), which holds both, and read again every
 * 15 seconds while teams may still be signing up.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import type { Registration } from '../../../hooks/useTournamentSignup';
import { RowList, Row } from '../../common/ui';
import { tokens } from '../../../theme/tokens';

const { color } = tokens;
const POLL_MS = 15_000;

interface TournamentTeamsListProps {
  tournamentId: number;
  teamSize: number;
  /** Changes whenever the saved team list does, to read the list again. */
  teamKey: string;
  canEdit: boolean;
  /** Teams sign themselves up: keep the list fresh. */
  live: boolean;
  onRemoved: () => void | Promise<void>;
}

export function TournamentTeamsList({ tournamentId, teamSize, teamKey, canEdit, live, onRemoved }: TournamentTeamsListProps) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api.get<{ registrations: Registration[] }>(`/api/tournament-signup/${tournamentId}`);
      setRows(body.registrations ?? []);
    } catch {
      // Keep what we had.
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
  }, [load, teamKey]);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const remove = async (row: Registration) => {
    setBusy(row.teamId);
    try {
      await api.delete(`/api/tournaments/${tournamentId}/teams/${encodeURIComponent(row.teamId)}`);
      showSuccess(t('tournament.setup.signup.removed', { team: row.teamName }));
      await onRemoved();
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return null;
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="setup-teams-empty">
        {live ? t('tournament.setup.signup.noneYet') : t('tournament.setup.signup.noTeams')}
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{t('tournament.setup.signup.inTournament', { count: rows.length })}</Typography>
      <RowList data-testid="setup-teams-list">
        {rows.map((row) => {
          const starters = row.lineup.filter((p) => p.role === 'starter');
          const checkedIn = row.lineup.filter((p) => p.checkedInAt !== null).length;
          const signedUp = row.registeredAt > 0;
          return (
            <Row
              key={row.teamId}
              data-testid={`setup-team-${row.teamId}`}
              columns="minmax(0, 1fr) auto"
              sx={{ alignItems: 'center', gap: 2 }}
            >
              <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{row.teamName}</Typography>
                  <Chip
                    size="small"
                    label={signedUp ? t('tournament.setup.signup.signedUp') : t('tournament.setup.signup.addedByYou')}
                    sx={{ bgcolor: color.paper3, color: signedUp ? color.accent : color.ink2 }}
                  />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {t('tournament.setup.signup.lineup', { starters: starters.length, size: teamSize })}
                  {checkedIn > 0 ? ` · ${t('tournament.setup.signup.checkedIn', { count: checkedIn })}` : ''}
                </Typography>
              </Box>
              {canEdit && (
                <Button
                  size="small"
                  color="inherit"
                  disabled={busy !== null}
                  onClick={() => void remove(row)}
                  data-testid={`setup-team-remove-${row.teamId}`}
                >
                  {t('tournament.setup.signup.remove')}
                </Button>
              )}
            </Row>
          );
        })}
      </RowList>
    </Stack>
  );
}
