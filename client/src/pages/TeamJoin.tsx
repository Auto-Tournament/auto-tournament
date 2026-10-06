import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { Panel } from '../components/common/ui';
import { useAuth } from '../contexts/AuthContext';
import { api, apiErrorMessage } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { paths, teamProfilePath } from '../paths';
import { radii, textSize, tokens } from '../theme/tokens';

const { color } = tokens;

interface InviteTeam {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  memberCount: number;
}

/**
 * A team's invite link (`/join/team/:code`): which team it is, and "Ask to
 * join". The owner or a captain then accepts or declines the request.
 */
export default function TeamJoin() {
  const { code = '' } = useParams<{ code: string }>();
  const { t } = useTranslation();
  const { playerSteamId } = useAuth();
  const [team, setTeam] = useState<InviteTeam | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'requested' | 'member'>('idle');
  const endpoint = `/api/team-directory/invite/${encodeURIComponent(code)}`;

  useEffect(() => {
    api
      .get<{ success: boolean; team: InviteTeam }>(endpoint)
      .then((res) => setTeam(res.team))
      .catch((err) => setError(apiErrorMessage(err, t('teamJoin.invalid'))));
  }, [endpoint, t]);

  useEffect(() => {
    document.title = pageTitle(
      team ? t('teamJoin.pageTitle', { name: team.name }) : t('teamJoin.title')
    );
  }, [team, t]);

  const ask = async () => {
    setStatus('sending');
    try {
      const res = await api.post<{ success: boolean; status: 'requested' | 'member' }>(endpoint);
      setStatus(res.status);
    } catch (err) {
      setStatus('idle');
      setError(apiErrorMessage(err, t('teamJoin.failed')));
    }
  };

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="team-join-page">
      <TopNavBar />
      <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
        {error && !team ? (
          <Alert severity="error">{error}</Alert>
        ) : !team ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('teamJoin.loading')} />
          </Box>
        ) : (
          <Panel
            sx={{ p: 4, display: 'grid', justifyItems: 'center', gap: 2, textAlign: 'center' }}
          >
            <Box
              sx={{
                width: 96,
                height: 96,
                borderRadius: radii.lg,
                bgcolor: color.paper3,
                border: `2px solid ${color.accent}`,
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
                fontWeight: 700,
                fontSize: textSize.xl,
                color: color.accent,
              }}
            >
              {team.logoUrl ? (
                <Box
                  component="img"
                  src={team.logoUrl}
                  alt=""
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                (team.tag || team.name.slice(0, 2)).toUpperCase()
              )}
            </Box>
            <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
              {t('teamJoin.invited')}
            </Typography>
            <Typography component="h1" sx={{ fontWeight: 700, fontSize: textSize['2xl'] }}>
              {team.name}
            </Typography>
            <Typography sx={{ color: color.ink2 }}>
              {t('teamsDirectory.members', { count: team.memberCount })}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {status === 'requested' ? (
              <Alert severity="success" data-testid="team-join-requested">
                {t('teamJoin.requested')}
              </Alert>
            ) : status === 'member' ? (
              <Button component={RouterLink} to={teamProfilePath(team.id)} variant="outlined">
                {t('teamJoin.alreadyMember')}
              </Button>
            ) : playerSteamId ? (
              <Button
                variant="contained"
                size="large"
                onClick={ask}
                disabled={status === 'sending'}
                data-testid="team-join-ask"
              >
                {t('teamJoin.ask')}
              </Button>
            ) : (
              <Button variant="contained" size="large" component={RouterLink} to={paths.login}>
                {t('teamJoin.signIn')}
              </Button>
            )}
          </Panel>
        )}
      </Container>
    </Box>
  );
}
