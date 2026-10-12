import { useEffect, useState } from 'react';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import { Box, Button, CircularProgress, Container, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';
import { tokens, fontDisplay } from '../theme/tokens';

const { color } = tokens;

/**
 * `/match/now`: one link for "my match" from anywhere (the nav bar, the
 * match-ready toast, Home, notices). It asks where the player's match lives
 * (a tournament's "Your match" tab, a matchmaking room, a team page) and goes
 * there; with none, it says so and offers Play and the tournaments.
 */
export default function MatchNow() {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    document.title = pageTitle(t('matchNow.title'));
    let live = true;
    api
      .get<{ success: boolean; path: string | null }>('/api/players/me/match-now')
      .then((res) => live && setPath(res.success ? res.path : null))
      .catch(() => live && setPath(null));
    return () => {
      live = false;
    };
  }, [t]);

  // Only the site's own pages: the API answers with a path, never an address.
  if (path && path.startsWith('/') && !path.startsWith('//')) return <Navigate to={path} replace />;

  return (
    <Box minHeight="100vh" data-testid="match-now-page">
      <TopNavBar />
      <Container
        maxWidth="sm"
        sx={{ py: { xs: 6, md: 10 }, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        {path === undefined ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress aria-label={t('matchNow.title')} />
          </Box>
        ) : (
          <>
            <Typography
              component="h1"
              sx={{ fontFamily: fontDisplay, fontSize: '2rem', fontWeight: 700 }}
            >
              {t('matchNow.none')}
            </Typography>
            <Typography sx={{ color: color.ink2 }}>{t('matchNow.noneBody')}</Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button component={RouterLink} to={paths.play} variant="contained">
                {t('matchNow.play')}
              </Button>
              <Button component={RouterLink} to={paths.root} variant="outlined">
                {t('matchNow.home')}
              </Button>
            </Box>
          </>
        )}
      </Container>
    </Box>
  );
}
