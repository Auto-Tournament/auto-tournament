import { Link as RouterLink } from 'react-router-dom';
import { Box, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { paths } from '../../paths';

interface SiteLink {
  key: string;
  to: string;
}

/** Core pages; the game integration's pages (CS2: Servers, Maps) come first. */
const CORE_SITE_LINKS: SiteLink[] = [
  { key: 'modules', to: paths.modules },
  { key: 'players', to: paths.players },
  { key: 'teams', to: paths.teams },
  { key: 'templates', to: paths.templates },
  { key: 'ratings', to: paths.eloTemplates },
  { key: 'settings', to: paths.settings },
  { key: 'adminTools', to: paths.admin },
];

/**
 * Admin home's "Site" link grid — every non-tournament admin page, each with
 * a one-line hint. This is where the old Dashboard's side-nav-only links
 * (servers, teams, players, settings, admin tools, ...) become reachable
 * from the home page itself.
 */
export function SiteLinksGrid() {
  const { t } = useTranslation();
  // Disputes (3.0 phase D, PR D8) sits next to the admin home rather than
  // inside it, and only where a result can be argued about — see
  // `useDisputesEntry`.
  const { show: showDisputes } = useDisputesEntry();
  // The game's own pages, from the module the tournament runs (3.0 phase E)
  // — see `useShellIntegrations`.
  const { shell } = useShellIntegrations();
  const siteLinks: SiteLink[] = [
    ...shell
      .flatMap((integration) => integration.navItems)
      .map((item) => ({ key: item.key, to: item.path })),
    ...(showDisputes ? [{ key: 'disputes', to: paths.disputes }] : []),
    ...CORE_SITE_LINKS,
  ];

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
        {siteLinks.map((link) => (
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
