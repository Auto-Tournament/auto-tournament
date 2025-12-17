import React from 'react';
import { Box, Card, CardContent, Container, Stack, Typography, Button } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LinkIcon from '@mui/icons-material/Link';
import { Link as RouterLink } from 'react-router-dom';

export default function PublicPages() {
  const origin =
    typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : '';

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Typography variant="body2" color="text.secondary" mb={4}>
        Quick links to the public pages you can share with players and viewers.
      </Typography>

      <Container maxWidth="md" disableGutters>
        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Public Player Search
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Search for registered players by name, Steam ID or profile URL.
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="contained"
                  startIcon={<OpenInNewIcon />}
                  component={RouterLink}
                  to="/player"
                >
                  Open /player
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      Public URL
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
                Player Profile (public)
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Direct link to a player profile by Steam ID64.
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<LinkIcon />}
                  disabled
                >
                  Requires Steam ID64
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      URL pattern
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
                Team Match Page (public)
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Read-only view of a team&apos;s current or most recent match.
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<LinkIcon />}
                  disabled
                >
                  Requires team ID
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      URL pattern
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
                Tournament Leaderboard (public)
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Public standings page for a specific tournament.
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<LinkIcon />}
                  disabled
                >
                  Requires tournament ID
                </Button>
                {origin && (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      URL pattern
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {origin}/tournament/&lt;tournamentId&gt;/leaderboard
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


