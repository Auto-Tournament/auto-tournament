import React from 'react';
import { Box, Button, Card, CardContent, Container, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box minHeight="100vh" bgcolor="background.default" py={6}>
      <Container maxWidth="sm">
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h2" fontWeight={700} gutterBottom>
              404
            </Typography>
            <Typography variant="h5" fontWeight={600} gutterBottom>
              Page not found
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={4}>
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </Typography>
            <Box display="flex" justifyContent="center" gap={2} flexWrap="wrap">
              <Button
                variant="contained"
                color="primary"
                onClick={() => navigate('/')}
              >
                Back to Dashboard
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => navigate('/player')}
              >
                Public Player Search
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}


