import { Link as RouterLink } from 'react-router-dom';
import { Box, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface SiteLink {
  key: string;
  to: string;
}

const SITE_LINKS: SiteLink[] = [
  { key: 'servers', to: '/servers' },
  { key: 'maps', to: '/maps' },
  { key: 'players', to: '/players' },
  { key: 'teams', to: '/teams' },
  { key: 'templates', to: '/templates' },
  { key: 'ratings', to: '/elo-templates' },
  { key: 'settings', to: '/settings' },
  { key: 'adminTools', to: '/admin' },
];

/**
 * Admin home's "Site" link grid — every non-tournament admin page, each with
 * a one-line hint. This is where the old Dashboard's side-nav-only links
 * (servers, teams, players, settings, admin tools, ...) become reachable
 * from the home page itself.
 */
export function SiteLinksGrid() {
  const { t } = useTranslation();

  return (
    <Box component="section" data-testid="admin-home-site-grid">
      <Typography variant="h5" fontWeight={700} mb={2}>
        {t('dashboard.site.title')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 1.5,
        }}
      >
        {SITE_LINKS.map((link) => (
          <Paper
            key={link.key}
            variant="outlined"
            component={RouterLink}
            to={link.to}
            data-testid={`admin-home-site-link-${link.key}`}
            sx={{
              p: 1.5,
              display: 'block',
              textDecoration: 'none',
              color: 'text.primary',
              '&:hover': { bgcolor: 'action.hover', borderColor: 'text.secondary' },
            }}
          >
            <Typography variant="body2" fontWeight={600}>
              {t(`dashboard.site.${link.key}.label`)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(`dashboard.site.${link.key}.hint`)}
            </Typography>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
