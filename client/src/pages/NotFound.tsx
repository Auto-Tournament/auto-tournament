import React, { useEffect } from 'react';
import { Box, Button, Card, CardContent, Container, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    document.title = t('notFound.title');
  }, [t]);

  return (
    <Box minHeight="100vh" bgcolor="background.default" py={6}>
      <Container maxWidth="sm">
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h2" fontWeight={700} gutterBottom>
              404
            </Typography>
            <Typography variant="h5" fontWeight={600} gutterBottom>
              {t('notFound.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={4}>
              {t('notFound.description')}
            </Typography>
            <Box display="flex" justifyContent="center" gap={2} flexWrap="wrap">
              <Button
                variant="contained"
                color="primary"
                onClick={() => navigate('/')}
              >
                {t('notFound.backToDashboard')}
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => navigate('/player')}
              >
                {t('notFound.publicPlayerSearch')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}


