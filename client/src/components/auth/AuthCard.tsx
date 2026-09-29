import React from 'react';
import { Box, Card, Container, Stack, Typography } from '@mui/material';
import { TopNavBar } from '../layout/TopNavBar';
import { AtIcon } from '../common/AtIcon';

/** The centred card the setup and admin login pages share with Login. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      <TopNavBar />
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <Container maxWidth="xs">
          <Card elevation={0} sx={{ p: { xs: 3, sm: 4 }, backgroundColor: 'background.paper' }}>
            <Stack spacing={3}>
              <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center' }}>
                <Box sx={{ width: 56, height: 56, borderRadius: '14px', overflow: 'hidden', display: 'flex' }}>
                  <AtIcon size={56} title="Auto Tournament Logo" />
                </Box>
                <Typography variant="h5" component="h1" fontWeight={600}>
                  {title}
                </Typography>
                {subtitle && (
                  <Typography variant="body2" color="text.secondary">
                    {subtitle}
                  </Typography>
                )}
              </Stack>
              {children}
            </Stack>
          </Card>
        </Container>
      </Box>
    </Box>
  );
}
