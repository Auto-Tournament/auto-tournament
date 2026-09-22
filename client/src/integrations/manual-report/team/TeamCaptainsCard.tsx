/**
 * Who may report a result for this team (3.0 phase D, PR D7).
 *
 * Fills the `teamAdminPanel` slot on the team page, and is the reason the rest
 * of phase D is reachable at all: D1's backfill found no captain information
 * anywhere in 2.x and created none, so on an upgraded instance every
 * `team_members` row is a plain member and every captain route refuses
 * everybody. Without somewhere to appoint one, manual reporting ships unusable.
 *
 * Admins only — the routes behind it are admin-only, and a member looking at
 * their own team page has nothing to do here.
 *
 * Deliberately small. It lists the team's memberships and toggles the captain
 * role on each; it does not add or remove players, because `teams.players` is
 * the roster of record and `teamMembers.syncFromRoster` mirrors it. The route
 * refuses an account that is not on the team already (409) for the same reason.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech';
import { useAuth } from '../../../contexts/AuthContext';
import type { TeamAdminPanelProps } from '../../types';
import { isNotOurs, manualReportApi, type TeamMember } from '../api';

export function TeamCaptainsCard({ teamId }: TeamAdminPanelProps) {
  const { t } = useTranslation();
  const { isAuthenticated: isAdmin } = useAuth();

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    void (async () => {
      const result = await manualReportApi.members(teamId);
      if (!live) return;
      if (result.ok && result.data) {
        setMembers(result.data.members);
      } else if (isNotOurs(result.status)) {
        // No manual-report module on this instance, or no such team. Not an
        // error an admin needs shouted at them on a team page.
        setHidden(true);
      } else {
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [isAdmin, teamId]);

  const setRole = async (member: TeamMember) => {
    setBusyUid(member.accountUid);
    setError(null);
    const next = member.role === 'captain' ? 'member' : 'captain';
    const result = await manualReportApi.setCaptain(teamId, member.accountUid, next);
    if (result.ok && result.data) {
      setMembers(result.data.members);
    } else {
      setError(result.error || t('manualReport.captains.failed'));
    }
    setBusyUid(null);
  };

  if (!isAdmin || hidden) return null;

  return (
    <Card data-testid="team-captains-card">
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <MilitaryTechIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('manualReport.captains.title')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('manualReport.captains.hint')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} data-testid="team-captains-error">
            {error}
          </Alert>
        )}

        {loading && (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!loading && members !== null && members.length === 0 && (
          <Typography variant="body2" color="text.secondary" data-testid="team-captains-empty">
            {t('manualReport.captains.empty')}
          </Typography>
        )}

        <Stack spacing={1.5}>
          {(members ?? []).map((member) => (
            <Paper
              key={member.accountUid}
              variant="outlined"
              data-testid={`team-captain-row-${member.accountUid}`}
              sx={{
                p: 2,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                justifyContent: 'space-between',
                gap: 1.5,
              }}
            >
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Typography variant="body1" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>
                  {member.name || t('manualReport.captains.unknown')}
                </Typography>
                {member.role === 'captain' && (
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={t('manualReport.captains.isCaptain')}
                    data-testid={`team-captain-chip-${member.accountUid}`}
                  />
                )}
              </Box>
              <Button
                size="small"
                variant={member.role === 'captain' ? 'text' : 'outlined'}
                color={member.role === 'captain' ? 'inherit' : 'primary'}
                disabled={busyUid !== null}
                sx={{ width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}
                data-testid={`team-captain-toggle-${member.accountUid}`}
                onClick={() => void setRole(member)}
              >
                {t(
                  member.role === 'captain'
                    ? 'manualReport.captains.remove'
                    : 'manualReport.captains.make'
                )}
              </Button>
            </Paper>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
