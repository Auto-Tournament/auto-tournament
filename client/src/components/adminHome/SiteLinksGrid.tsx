import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { paths } from '../../paths';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { SectionHead } from '../common/ui';
import { tokens, radii, textSize } from '../../theme/tokens';

const { color } = tokens;

interface SiteLink {
  key: string;
  to: string;
  /** A module's page carries its own words; a core page's come from `dashboard.site.<key>`. */
  label?: string;
  hint?: string;
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
    ...moduleNavItems(shell).map((item) => ({
      key: item.key,
      to: item.path,
      label: navItemLabel(t, item, 'siteLabel'),
      hint: navItemLabel(t, item, 'siteHint'),
    })),
    ...(showDisputes ? [{ key: 'disputes', to: paths.disputes }] : []),
    ...CORE_SITE_LINKS,
  ];

  return (
    <Box component="section" aria-labelledby="admin-home-site-title" data-testid="admin-home-site-grid">
      <SectionHead id="admin-home-site-title" title={t('dashboard.site.title')} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
          gap: 1,
        }}
      >
        {siteLinks.map((link) => (
          <Box
            key={link.key}
            component={RouterLink}
            to={link.to}
            data-testid={`admin-home-site-link-${link.key}`}
            sx={{
              display: 'block',
              px: 2,
              py: 1.5,
              border: `1px solid ${color.rule}`,
              borderRadius: radii.md,
              fontSize: textSize.sm,
              color: color.ink,
              textDecoration: 'none',
              '&:hover': { bgcolor: color.paper2 },
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
            }}
          >
            {link.label ?? t(`dashboard.site.${link.key}.label`)}
            <Box component="small" sx={{ display: 'block', color: color.muted, fontSize: textSize.xs }}>
              {link.hint ?? t(`dashboard.site.${link.key}.hint`)}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
