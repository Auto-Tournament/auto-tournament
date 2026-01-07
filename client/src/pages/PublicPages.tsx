import React from 'react';
import { Box, Card, CardContent, Container, Stack, Typography, Button } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LinkIcon from '@mui/icons-material/Link';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PublicPages() {
  const origin =
    typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : '';
  const { t } = useTranslation();

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Typography variant="body2" color="text.secondary" mb={4}>
        {t('publicLinks.intro')}
      </Typography>

      <Container maxWidth="md" disableGutters>
        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {t('publicLinks.playerSearch.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('publicLinks.playerSearch.description')}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="contained"
                  startIcon={<OpenInNewIcon />}
                  component={RouterLink}
                  to="/player"
                >
                  {t('publicLinks.playerSearch.openButton')}
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {t('publicLinks.common.publicUrl')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {origin}/player
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {t('publicLinks.playerProfile.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('publicLinks.playerProfile.description')}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<LinkIcon />}
                  disabled
                >
                  {t('publicLinks.playerProfile.requiresSteamId')}
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {t('publicLinks.common.urlPattern')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {origin}/player/&lt;steamId64&gt;
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {t('publicLinks.teamMatch.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('publicLinks.teamMatch.description')}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<LinkIcon />}
                  component={RouterLink}
                  to="/team/test-team-astralis"
                >
                  {t('publicLinks.teamMatch.openExample')}
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {t('publicLinks.common.urlPattern')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {origin}/team/&lt;teamId&gt;
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {t('publicLinks.tournamentLeaderboard.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('publicLinks.tournamentLeaderboard.description')}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<OpenInNewIcon />}
                  component={RouterLink}
                  to="/tournament/1/leaderboard"
                >
                  {t('publicLinks.tournamentLeaderboard.open')}
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {t('publicLinks.common.publicUrl')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {origin}/tournament/1/leaderboard
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}


