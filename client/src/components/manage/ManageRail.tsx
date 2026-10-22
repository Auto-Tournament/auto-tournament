import React from 'react';
import { Box, Drawer, IconButton } from '@mui/material';
import {
  ArrowLeftIcon,
  BellIcon,
  BroadcastIcon,
  FlagIcon,
  ListBulletsIcon,
  ListIcon,
  TrophyIcon,
  FilmSlateIcon,
  FilmStripIcon,
  ArrowSquareOutIcon,
  BookOpenIcon,
  CodeIcon,
  GearIcon,
  PuzzlePieceIcon,
  SealCheckIcon,
  StackIcon,
  UserIcon,
  UsersThreeIcon,
  WrenchIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { manageTournamentPath, paths } from '../../paths';
import { useOptionalAdminTournament } from '../../contexts/AdminTournamentContext';
import { useManageRailCounts } from '../../contexts/ManageRailContext';
import { RAIL_COLUMN_MIN_WIDTH, RAIL_ROW_MAX_WIDTH } from '../../constants/adminLayout';
import { AtIcon } from '../common/AtIcon';
import { AccountMenu } from '../layout/AccountMenu';
import { SiteSearch } from '../search/SiteSearch';
import { api } from '../../utils/api';
import { tokens, fontDisplay, fontMono, radii, textSize } from '../../theme/tokens';
import { ICON_SIZE } from '../../theme/icons';
import type { IntegrationNavIcon } from '../../integrations/types';

const { color } = tokens;

/** Read by a screen reader, not shown. */
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

const DOCS_URL = 'https://docs.autotournament.gg';

/** The rail's width beside the page (the ManageShell board: 248px). */
export const MANAGE_RAIL_WIDTH = 248;

interface RailItem {
  key: string;
  label: string;
  to: string;
  /**
   * Shown before the label, decorative (the label says it). Core's items use
   * Phosphor; a module's item brings its own (`IntegrationNavItem.icon`).
   */
  icon?: IntegrationNavIcon;
  /** Something waiting for an admin; nothing else gets a number. */
  count?: number | null;
  /** A tournament's state (live, setup), in words. */
  state?: { label: string; live: boolean };
  /** Opens outside the app (documentation). */
  external?: boolean;
  /** Current only on its own address, not the pages below it (All tournaments). */
  exact?: boolean;
  /** Other addresses that are this item too (Ratings is a tab of Templates). */
  also?: string[];
}

interface RailGroup {
  key: string;
  label: string;
  items: RailItem[];
}

/** The page an item is "on": its own path, or a page below it. */
function isCurrent(pathname: string, to: string, item?: Pick<RailItem, 'exact' | 'also'>): boolean {
  if (item?.also?.some((other) => pathname === other || pathname.startsWith(`${other}/`)))
    return true;
  if (item?.exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Open player reports, for the badge on Reports. Read again on every page. */
function useOpenReports(pathname: string): number | null {
  const [open, setOpen] = React.useState<number | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ open?: number }>('/api/player-reports?status=open')
      .then((res) => {
        if (!cancelled) setOpen(typeof res.open === 'number' ? res.open : null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  return open;
}

/** Every group, in the ManageShell board's order. */
function useRailGroups(pathname: string): RailGroup[] {
  const { t } = useTranslation();
  const isDevelopment = useIsDevelopment();
  const { needsYouCount } = useManageRailCounts();
  const openReports = useOpenReports(pathname);

  // The tournaments being run or set up (not archived), at most three.
  const adminTournaments = useOptionalAdminTournament()?.tournaments ?? [];
  const activeTournaments = adminTournaments
    .filter(
      (x) =>
        !x.archived && (x.status === 'in_progress' || x.status === 'setup' || x.status === 'ready')
    )
    .slice(0, 3);

  // One group per game the shell follows (the tournament's, or every
  // installed one with no tournament), with pages of its own, named by it.
  const { shell } = useShellIntegrations();
  const games: RailGroup[] = shell
    .filter((integration) => integration.navItems.length > 0)
    .map((integration) => ({
      key: `game-${integration.id}`,
      label: t('managePage.rail.groups.gamesOf', {
        game: t('managePage.rail.group', {
          ns: integration.id,
          defaultValue: t('managePage.rail.groups.game'),
        }),
      }),
      items: moduleNavItems([integration]).map((item) => ({
        key: item.key,
        label: navItemLabel(t, item, 'rail'),
        to: item.path,
        icon: item.icon,
      })),
    }));

  const groups: RailGroup[] = [
    {
      key: 'home',
      label: t('managePage.rail.groups.home'),
      items: [
        {
          key: 'needsYou',
          label: t('managePage.rail.needsYou'),
          to: paths.manage,
          icon: BellIcon,
          exact: true,
          count: needsYouCount,
        },
        {
          key: 'liveMatches',
          label: t('managePage.rail.liveMatches'),
          to: paths.liveMatches,
          icon: BroadcastIcon,
        },
      ],
    },
    {
      key: 'tournament',
      label: t('managePage.rail.groups.tournaments'),
      items: [
        // The ones being run or set up, by name and state: one click into it.
        ...activeTournaments.map((x) => ({
          key: `tournament-${x.id}`,
          label: x.name,
          to: manageTournamentPath(x.id),
          also: [`${paths.tournaments}/${x.id}`],
          icon: TrophyIcon,
          state:
            x.status === 'in_progress'
              ? { label: t('managePage.rail.state.live'), live: true }
              : { label: t('managePage.rail.state.setup'), live: false },
        })),
        {
          key: 'tournaments',
          label: t('managePage.rail.allTournaments'),
          to: paths.tournaments,
          icon: ListBulletsIcon,
          exact: true,
        },
      ],
    },
    ...games,
    {
      key: 'history',
      label: t('managePage.rail.groups.history'),
      items: [
        {
          key: 'playedMatches',
          label: t('managePage.rail.playedMatches'),
          to: paths.playedMatches,
          icon: FilmStripIcon,
        },
        {
          key: 'highlights',
          label: t('managePage.rail.highlights'),
          to: paths.highlights,
          icon: FilmSlateIcon,
        },
      ],
    },
    {
      key: 'people',
      label: t('managePage.rail.groups.people'),
      items: [
        { key: 'teams', label: t('managePage.rail.teams'), to: paths.teams, icon: UsersThreeIcon },
        { key: 'players', label: t('managePage.rail.players'), to: paths.players, icon: UserIcon },
        {
          key: 'reports',
          label: t('managePage.rail.reports'),
          to: paths.reports,
          icon: FlagIcon,
          count: openReports,
        },
      ],
    },
    {
      key: 'setup',
      label: t('managePage.rail.groups.setup'),
      items: [
        {
          key: 'templates',
          label: t('managePage.rail.templatesAndRatings'),
          to: paths.templates,
          also: [paths.eloTemplates],
          icon: StackIcon,
        },
        {
          key: 'modules',
          label: t('managePage.rail.modules'),
          to: paths.modules,
          icon: PuzzlePieceIcon,
        },
        {
          key: 'settings',
          label: t('managePage.rail.settings'),
          to: paths.settings,
          icon: GearIcon,
        },
        {
          key: 'license',
          label: t('managePage.rail.license'),
          to: paths.license,
          icon: SealCheckIcon,
        },
      ],
    },
    {
      key: 'system',
      label: t('managePage.rail.groups.system'),
      items: [
        {
          key: 'adminTools',
          label: t('managePage.rail.adminTools'),
          to: paths.admin,
          icon: WrenchIcon,
        },
        ...(isDevelopment
          ? [
              {
                key: 'devTools',
                label: t('managePage.rail.devTools'),
                to: paths.dev,
                icon: CodeIcon,
              },
            ]
          : []),
        {
          key: 'documentation',
          label: t('managePage.rail.documentation'),
          to: DOCS_URL,
          icon: BookOpenIcon,
          external: true,
        },
      ],
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function RailLink({
  item,
  pathname,
  onNavigate,
}: {
  item: RailItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const selected = !item.external && isCurrent(pathname, item.to, item);
  const Icon = item.icon;
  const linkProps = item.external
    ? { component: 'a' as const, href: item.to, target: '_blank', rel: 'noopener noreferrer' }
    : { component: RouterLink, to: item.to, onClick: onNavigate };
  return (
    <Box
      {...linkProps}
      data-testid={`manage-rail-${item.key}`}
      aria-current={selected ? 'page' : undefined}
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 1.25,
        minHeight: 34,
        px: 1.25,
        borderRadius: radii.sm,
        color: selected ? color.ink : color.ink2,
        bgcolor: selected ? color.paper2 : 'transparent',
        textDecoration: 'none',
        fontWeight: 500,
        lineHeight: 1.3,
        '&:hover': { bgcolor: color.paper2, color: color.ink },
        '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      <Box
        component="span"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '1 1 auto' }}
      >
        {Icon && (
          <Box
            component="span"
            data-testid={`manage-rail-${item.key}-icon`}
            data-weight={selected ? 'fill' : 'regular'}
            sx={{
              display: 'inline-flex',
              flex: 'none',
              // Sized here as well as by `size`, so a module's icon that
              // ignores `size` (an MUI one) fits too.
              '& > svg': { width: ICON_SIZE.md, height: ICON_SIZE.md },
            }}
          >
            <Icon size={ICON_SIZE.md} weight={selected ? 'fill' : 'regular'} aria-hidden />
          </Box>
        )}
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {item.label}
        </Box>
      </Box>
      {item.external && (
        <>
          <ArrowSquareOutIcon
            aria-hidden
            size={ICON_SIZE.sm}
            style={{ flex: 'none', color: color.ink2 }}
          />
          <Box component="span" sx={visuallyHidden}>
            {t('managePage.rail.opensInNewTab')}
          </Box>
        </>
      )}
      {item.state && (
        <Box
          component="span"
          data-testid={`manage-rail-${item.key}-state`}
          sx={{
            flex: 'none',
            fontSize: textSize.xs,
            color: item.state.live ? color.live : color.muted,
          }}
        >
          {item.state.label}
        </Box>
      )}
      {typeof item.count === 'number' && item.count > 0 && (
        <Box
          component="span"
          data-testid={`manage-rail-${item.key}-count`}
          sx={{ flex: 'none', fontFamily: fontMono, fontSize: textSize.xs, color: color.accent }}
        >
          {item.count}
        </Box>
      )}
    </Box>
  );
}

/** The rail's contents: brand, search, every group, the way back and the account. */
function RailBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const groups = useRailGroups(pathname);
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  // Taller than the window: bring the current page's item into view.
  const itemKeys = groups.flatMap((group) => group.items.map((item) => item.key)).join(',');
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    const box = scroller.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < box.top || item.bottom > box.bottom) {
      scroller.scrollTop += item.top - box.top - (box.height - item.height) / 2;
    }
  }, [pathname, itemKeys]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1 }}>
        <Box
          sx={{ height: 28, width: 28, borderRadius: '8px', overflow: 'hidden', display: 'flex' }}
        >
          <AtIcon size={28} title="" />
        </Box>
        <Box component="span" sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 15 }}>
          Auto Tournament
        </Box>
      </Box>
      <Box sx={{ px: 1 }}>
        <SiteSearch variant="field" />
      </Box>
      <Box
        ref={scrollerRef}
        data-testid="manage-rail-scroller"
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.75,
        }}
      >
        {groups.map((group) => (
          // A group of links, not a <ul>: the items are links (axe `list`).
          <Box
            key={group.key}
            role="group"
            data-testid={`manage-rail-group-${group.key}`}
            aria-labelledby={`manage-rail-heading-${group.key}`}
            sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.25 }}
          >
            <Box
              component="span"
              id={`manage-rail-heading-${group.key}`}
              sx={{
                fontFamily: fontMono,
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: color.muted,
                px: 1.25,
                pb: 0.75,
              }}
            >
              {group.label}
            </Box>
            {group.items.map((item) => (
              <RailLink key={item.key} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 0.25,
          borderTop: `1px solid ${color.rule}`,
          pt: 1.5,
        }}
      >
        <Box
          component={RouterLink}
          to={paths.root}
          data-testid="manage-back-to-site"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 34,
            px: 1.25,
            borderRadius: radii.sm,
            color: color.ink2,
            textDecoration: 'none',
            '&:hover': { bgcolor: color.paper2, color: color.ink },
            '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
          }}
        >
          <ArrowLeftIcon size={ICON_SIZE.md} aria-hidden />
          {t('nav.backToSite')}
        </Box>
        <Box sx={{ px: 0.5 }}>
          <AccountMenu wide />
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The admin menu, the whole menu of Manage (no site top bar there). As on
 * the ManageShell board: the brand and search at the top, every admin page
 * in named groups (Home, Tournaments, each game's own group, History,
 * People, Setup, System), and the way back to the site and the account at
 * the bottom. Sticky at the window's full height beside the page; it
 * scrolls on its own when taller.
 *
 * Badges are for work only: Needs you and open reports. Tournaments being
 * run or set up are listed by name with their state.
 *
 * At or below 820px the rail is a menu button in a sticky header that opens
 * it as a full-height drawer.
 */
export const ManageRail: React.FC = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <Box
        component="nav"
        aria-label={t('managePage.rail.label')}
        data-testid="manage-rail"
        sx={{
          display: 'none',
          displayPrint: 'none',
          [RAIL_COLUMN_MIN_WIDTH]: {
            display: 'block',
            position: 'sticky',
            top: 'var(--mat-impersonation-height, 0px)',
            alignSelf: 'flex-start',
            flex: `0 0 ${MANAGE_RAIL_WIDTH}px`,
            width: MANAGE_RAIL_WIDTH,
            height: 'calc(100vh - var(--mat-impersonation-height, 0px))',
            boxSizing: 'border-box',
            px: 1.75,
            py: 2.5,
            bgcolor: color.paper,
            borderRight: `1px solid ${color.rule}`,
            fontSize: textSize.sm,
          },
        }}
      >
        <RailBody />
      </Box>
      <Box
        component="header"
        data-testid="manage-phone-header"
        sx={{
          display: 'none',
          displayPrint: 'none',
          [RAIL_ROW_MAX_WIDTH]: {
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            position: 'sticky',
            top: 'var(--mat-impersonation-height, 0px)',
            zIndex: (theme) => theme.zIndex.appBar,
            px: 2,
            py: 1.25,
            bgcolor: color.paper,
            borderBottom: `1px solid ${color.rule}`,
          },
        }}
      >
        <IconButton
          onClick={() => setOpen(true)}
          aria-label={t('managePage.rail.openMenu')}
          aria-expanded={open}
          aria-controls="manage-rail-drawer"
          data-testid="manage-rail-open"
          sx={{ width: 44, height: 44, border: `1px solid ${color.rule}`, borderRadius: radii.sm }}
        >
          <ListIcon size={ICON_SIZE.lg} aria-hidden />
        </IconButton>
        <Box component="span" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
          {t('nav.manageHome')}
        </Box>
      </Box>
      <Drawer
        id="manage-rail-drawer"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            width: 300,
            maxWidth: '86vw',
            height: '100%',
            bgcolor: color.paper,
            px: 1.75,
            py: 2.5,
          },
        }}
      >
        <Box
          component="nav"
          aria-label={t('managePage.rail.label')}
          data-testid="manage-rail-drawer"
          sx={{ flex: '1 1 auto', minHeight: 0, fontSize: textSize.sm, position: 'relative' }}
        >
          <IconButton
            onClick={() => setOpen(false)}
            aria-label={t('managePage.rail.closeMenu')}
            sx={{ position: 'absolute', top: -6, right: 0, width: 44, height: 44, zIndex: 1 }}
          >
            <XIcon size={ICON_SIZE.md} aria-hidden />
          </IconButton>
          <RailBody onNavigate={() => setOpen(false)} />
        </Box>
      </Drawer>
    </>
  );
};
