import React from 'react';
import { Box } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { useManageRailCounts } from '../../contexts/ManageRailContext';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { paths } from '../../paths';
import { RAIL_COLUMN_MIN_WIDTH, railColumnSx } from '../../constants/adminLayout';
import { BELOW_NAV_STICKY_TOP } from '../../constants/navBar';
import { tokens, fontMono, radii, textSize } from '../../theme/tokens';

const { color } = tokens;

/** Read by a screen reader, not shown (the draft's `.sr-only`). */
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

const DOCS_URL = 'https://docs.autotournament.gg';

interface RailItem {
  key: string;
  label: string;
  to: string;
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
          count: needsYouCount,
        },
        { key: 'matches', label: t('managePage.rail.matches'), to: paths.matches },
        { key: 'bracket', label: t('managePage.rail.bracket'), to: paths.bracket },
        // Only where a result can be argued about at all (3.0 phase D).
        ...(showDisputes
          ? [{ key: 'disputes', label: t('managePage.rail.disputes'), to: paths.disputes }]
          : []),
      ],
    },
    {
      key: 'tournament',
      label: t('managePage.rail.groups.tournament'),
      items: [
        { key: 'tournament', label: t('managePage.rail.tournament'), to: paths.tournament },
        // What players see, once there is a tournament to show.
        ...(tournamentId !== null
          ? [
              {
                key: 'publicPage',
                label: t('managePage.rail.publicPage'),
                to: paths.tournamentOverview.replace(':id', String(tournamentId)),
              },
            ]
          : []),
      ],
    },
    {
      key: 'people',
      label: t('managePage.rail.groups.people'),
      items: [
        { key: 'teams', label: t('managePage.rail.teams'), to: paths.teams },
        { key: 'players', label: t('managePage.rail.players'), to: paths.players },
      ],
    },
    {
      key: 'game',
      label: t('managePage.rail.groups.game'),
      items: moduleNavItems(shell).map((item) => ({
        key: item.key,
        label: navItemLabel(t, item, 'rail'),
        to: item.path,
      })),
    },
    {
      key: 'configuration',
      label: t('managePage.rail.groups.configuration'),
      items: [
        { key: 'modules', label: t('managePage.rail.modules'), to: paths.modules },
        { key: 'templates', label: t('managePage.rail.templates'), to: paths.templates },
        { key: 'ratings', label: t('managePage.rail.ratings'), to: paths.eloTemplates },
        { key: 'settings', label: t('managePage.rail.settings'), to: paths.settings },
        { key: 'adminTools', label: t('managePage.rail.adminTools'), to: paths.admin },
        ...(isDevelopment
          ? [{ key: 'devTools', label: t('managePage.rail.devTools'), to: paths.dev }]
          : []),
        {
          key: 'documentation',
          label: t('managePage.rail.documentation'),
          to: DOCS_URL,
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
    <Box
      component="nav"
      aria-label={t('managePage.rail.label')}
      data-testid="manage-rail"
      sx={{
        // A horizontal scroller under 820px, so it never makes the page
        // scroll sideways; a sticky column beside the page above that. A
        // plain list, as in the draft: no box around it, no icons.
        ...railColumnSx,
        fontSize: textSize.sm,
      }}
    >
      <Box
        ref={scrollerRef}
        data-testid="manage-rail-scroller"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          overflowX: 'auto',
          [RAIL_COLUMN_MIN_WIDTH]: {
            display: 'block',
            overflowX: 'hidden',
            overflowY: 'auto',
            // Taller than the window (a small laptop, every group open):
            // the rail scrolls on its own instead of hiding its last items.
            maxHeight: `calc(100vh - ${BELOW_NAV_STICKY_TOP} - 24px)`,
          },
        }}
      >
        {groups.map((group, index) => (
          <React.Fragment key={group.key}>
            {/* Groups are split by a rule, as in the draft; the phone's
                single row has no room for one. */}
            {index > 0 && (
              <Box
                component="hr"
                aria-hidden
                sx={{
                  display: 'none',
                  [RAIL_COLUMN_MIN_WIDTH]: {
                    display: 'block',
                    border: 0,
                    borderTop: `1px solid ${color.rule}`,
                    my: 1.5,
                    mx: 0,
                  },
                }}
              />
            )}
            {/* A group of links, not a <ul>: the items are links, and a
                <ul> may only hold <li>s (axe `list`). The hidden heading
                names the group for a screen reader; the rule shows it to
                everyone else. */}
            <Box
              role="group"
              data-testid={`manage-rail-group-${group.key}`}
              aria-labelledby={`manage-rail-heading-${group.key}`}
              sx={{
                // Holds the hidden heading, which would otherwise widen the
                // page from wherever the scrolled row put it.
                position: 'relative',
                display: 'flex',
                flex: '0 0 auto',
                gap: 0.5,
                [RAIL_COLUMN_MIN_WIDTH]: { display: 'grid' },
              }}
            >
              <Box component="span" id={`manage-rail-heading-${group.key}`} sx={visuallyHidden}>
                {group.label}
              </Box>
              {group.items.map((item) => {
                const selected = !item.external && isCurrent(pathname, item.to);
                const linkProps = item.external
                  ? { component: 'a' as const, href: item.to, target: '_blank', rel: 'noopener noreferrer' }
                  : { component: RouterLink, to: item.to };
                return (
                  <Box
                    key={item.key}
                    {...linkProps}
                    data-testid={`manage-rail-${item.key}`}
                    aria-current={selected ? 'page' : undefined}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 1.5,
                      flex: '0 0 auto',
                      px: 1.5,
                      py: 1,
                      borderRadius: radii.sm,
                      color: selected ? color.ink : color.ink2,
                      bgcolor: selected ? color.paper2 : 'transparent',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.4,
                      '&:hover': { bgcolor: color.paper2, color: color.ink },
                      '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                    }}
                  >
                    {item.label}
                    {typeof item.count === 'number' && item.count > 0 && (
                      <Box
                        component="span"
                        data-testid={`manage-rail-${item.key}-count`}
                        sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.accent }}
                      >
                        {item.count}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};
