import React from 'react';
import {
  Box,
  Chip,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Paper,
} from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import InboxIcon from '@mui/icons-material/Inbox';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GavelIcon from '@mui/icons-material/Gavel';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import PublicIcon from '@mui/icons-material/Public';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import ExtensionIcon from '@mui/icons-material/Extension';
import DescriptionIcon from '@mui/icons-material/Description';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SettingsIcon from '@mui/icons-material/Settings';
import CampaignIcon from '@mui/icons-material/Campaign';
import BuildIcon from '@mui/icons-material/Build';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import { useTranslation } from 'react-i18next';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { useManageRailCounts } from '../../contexts/ManageRailContext';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { paths } from '../../paths';
import { RAIL_COLUMN_MIN_WIDTH } from '../../constants/adminLayout';
import { BELOW_NAV_STICKY_TOP } from '../../constants/navBar';

const DOCS_URL = 'https://docs.autotournament.gg';

interface RailItem {
  key: string;
  label: string;
  to: string;
  icon: React.ElementType;
  /** Only set where a real count exists; omitted items show no badge. */
  count?: number | null;
  /** Opens outside the app (documentation). */
  external?: boolean;
}

interface RailGroup {
  key: string;
  label: string;
  items: RailItem[];
}

/** The page an item is "on": its own path, or a page below it. */
function isCurrent(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The admin menu: every admin page, grouped, beside every admin page's
 * content (`Layout`). It replaced the 2.x sidebar in 3.0, which had grown
 * into a second copy of this list.
 *
 * The game's own pages (CS2: Servers, Maps) come from the module the
 * tournament runs, through its `navItems` and labelled from its own strings
 * (see `useShellIntegrations`); core names none of them. A module with no
 * pages leaves its group out.
 */
export const ManageRail: React.FC = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { shell, tournamentId } = useShellIntegrations();
  const { show: showDisputes } = useDisputesEntry();
  const isDevelopment = useIsDevelopment();
  const { needsYouCount } = useManageRailCounts();
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  const groups: RailGroup[] = [
    {
      key: 'operate',
      label: t('managePage.rail.groups.operate'),
      items: [
        {
          key: 'needsYou',
          label: t('managePage.rail.needsYou'),
          to: paths.manage,
          icon: InboxIcon,
          count: needsYouCount,
        },
        { key: 'matches', label: t('managePage.rail.matches'), to: paths.matches, icon: SportsEsportsIcon },
        { key: 'bracket', label: t('managePage.rail.bracket'), to: paths.bracket, icon: AccountTreeIcon },
        // Only where a result can be argued about at all (3.0 phase D).
        ...(showDisputes
          ? [{ key: 'disputes', label: t('managePage.rail.disputes'), to: paths.disputes, icon: GavelIcon }]
          : []),
      ],
    },
    {
      key: 'tournament',
      label: t('managePage.rail.groups.tournament'),
      items: [
        { key: 'tournament', label: t('managePage.rail.tournament'), to: paths.tournament, icon: EmojiEventsIcon },
        // What players see, once there is a tournament to show.
        ...(tournamentId !== null
          ? [
              {
                key: 'publicPage',
                label: t('managePage.rail.publicPage'),
                to: paths.tournamentOverview.replace(':id', String(tournamentId)),
                icon: PublicIcon,
              },
            ]
          : []),
      ],
    },
    {
      key: 'people',
      label: t('managePage.rail.groups.people'),
      items: [
        { key: 'teams', label: t('managePage.rail.teams'), to: paths.teams, icon: GroupsIcon },
        { key: 'players', label: t('managePage.rail.players'), to: paths.players, icon: PersonIcon },
      ],
    },
    {
      key: 'game',
      label: t('managePage.rail.groups.game'),
      items: moduleNavItems(shell).map((item) => ({
        key: item.key,
        label: navItemLabel(t, item, 'rail'),
        to: item.path,
        icon: item.icon,
      })),
    },
    {
      key: 'configuration',
      label: t('managePage.rail.groups.configuration'),
      items: [
        { key: 'modules', label: t('managePage.rail.modules'), to: paths.modules, icon: ExtensionIcon },
        { key: 'templates', label: t('managePage.rail.templates'), to: paths.templates, icon: DescriptionIcon },
        { key: 'ratings', label: t('managePage.rail.ratings'), to: paths.eloTemplates, icon: TrendingUpIcon },
        { key: 'settings', label: t('managePage.rail.settings'), to: paths.settings, icon: SettingsIcon },
        { key: 'adminTools', label: t('managePage.rail.adminTools'), to: paths.admin, icon: CampaignIcon },
        ...(isDevelopment
          ? [{ key: 'devTools', label: t('managePage.rail.devTools'), to: paths.dev, icon: BuildIcon }]
          : []),
        {
          key: 'documentation',
          label: t('managePage.rail.documentation'),
          to: DOCS_URL,
          icon: LibraryBooksIcon,
          external: true,
        },
      ],
    },
  ].filter((group) => group.items.length > 0);

  // On a phone the rail scrolls sideways: bring the current page's item into
  // view, or "Settings" would be selected somewhere off to the right. Again
  // when items arrive (the module's pages load after the core ones), since
  // they push the current one along.
  const itemKeys = groups.flatMap((group) => group.items.map((item) => item.key)).join(',');
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    const box = scroller.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.left < box.left || item.right > box.right) {
      scroller.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
    }
    if (item.top < box.top || item.bottom > box.bottom) {
      scroller.scrollTop += item.top - box.top - (box.height - item.height) / 2;
    }
  }, [pathname, itemKeys]);

  return (
    <Paper
      component="nav"
      variant="outlined"
      aria-label={t('managePage.rail.label')}
      data-testid="manage-rail"
      sx={{
        // A horizontal scroller under 820px, so it never makes the page
        // scroll sideways; a sticky column beside the page above that.
        position: 'static',
        width: '100%',
        minWidth: 0,
        flex: '0 0 auto',
        displayPrint: 'none',
        [RAIL_COLUMN_MIN_WIDTH]: {
          position: 'sticky',
          top: BELOW_NAV_STICKY_TOP,
          alignSelf: 'flex-start',
          width: 220,
          flex: '0 0 220px',
        },
      }}
    >
      <Box
        ref={scrollerRef}
        data-testid="manage-rail-scroller"
        sx={{
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          p: 0.5,
          [RAIL_COLUMN_MIN_WIDTH]: {
            display: 'block',
            overflowX: 'hidden',
            overflowY: 'auto',
            p: 1,
            // Taller than the window (a small laptop, every group open):
            // the rail scrolls on its own instead of hiding its last items.
            maxHeight:
              `calc(100vh - ${BELOW_NAV_STICKY_TOP} - 24px)`,
          },
        }}
      >
        {groups.map((group) => (
          // A group of links, not a <ul>: the items are links, and a <ul>
          // may only hold <li>s (axe `list`).
          <List
            key={group.key}
            component="div"
            role="group"
            dense
            disablePadding
            data-testid={`manage-rail-group-${group.key}`}
            aria-labelledby={`manage-rail-heading-${group.key}`}
            subheader={
              <ListSubheader
                component="div"
                id={`manage-rail-heading-${group.key}`}
                disableSticky
                disableGutters
                sx={{
                  // The row on a phone has no room for headings; the list
                  // keeps its name through aria-labelledby.
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  overflow: 'hidden',
                  clip: 'rect(0 0 0 0)',
                  whiteSpace: 'nowrap',
                  [RAIL_COLUMN_MIN_WIDTH]: {
                    position: 'static',
                    width: 'auto',
                    height: 'auto',
                    overflow: 'visible',
                    clip: 'auto',
                    px: 1.5,
                    pt: 1,
                    pb: 0.25,
                    lineHeight: 1.6,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    bgcolor: 'transparent',
                  },
                }}
              >
                {group.label}
              </ListSubheader>
            }
            sx={{
              display: 'flex',
              flex: '0 0 auto',
              gap: 0.25,
              [RAIL_COLUMN_MIN_WIDTH]: {
                display: 'block',
                '& + &': { mt: 0.5 },
              },
            }}
          >
            {group.items.map((item) => {
              const selected = !item.external && isCurrent(pathname, item.to);
              const Icon = item.icon;
              const linkProps = item.external
                ? { component: 'a' as const, href: item.to, target: '_blank', rel: 'noopener noreferrer' }
                : { component: RouterLink, to: item.to };
              return (
                <ListItemButton
                  key={item.key}
                  {...linkProps}
                  data-testid={`manage-rail-${item.key}`}
                  selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  sx={{
                    borderRadius: 1,
                    whiteSpace: 'nowrap',
                    flex: '0 0 auto',
                    [RAIL_COLUMN_MIN_WIDTH]: { mb: 0.25 },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                  {typeof item.count === 'number' && item.count > 0 && (
                    <Chip label={item.count} size="small" color="primary" sx={{ ml: 1 }} />
                  )}
                </ListItemButton>
              );
            })}
          </List>
        ))}
      </Box>
    </Paper>
  );
};
