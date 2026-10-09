import React from 'react';
import { Box, ButtonBase, Menu, MenuItem } from '@mui/material';
import {
  FlagIcon,
  ListBulletsIcon,
  FilmStripIcon,
  ArrowSquareOutIcon,
  BookOpenIcon,
  CaretUpDownIcon,
  ChartLineUpIcon,
  CodeIcon,
  GearIcon,
  PuzzlePieceIcon,
  StackIcon,
  UserIcon,
  UsersThreeIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listIntegrations } from '../../integrations/registry';
import { gameMonogram } from '../games/GameThumb';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { paths } from '../../paths';
import { RAIL_COLUMN_MIN_WIDTH, railColumnSx } from '../../constants/adminLayout';
import { BELOW_NAV_STICKY_TOP } from '../../constants/navBar';
import { tokens, fontMono, radii, textSize } from '../../theme/tokens';
import { ICON_SIZE } from '../../theme/icons';
import type { IntegrationNavIcon } from '../../integrations/types';

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
  /**
   * Shown before the label, decorative (the label says it). Core's items use
   * Phosphor; a module's item brings its own (`IntegrationNavItem.icon`).
   */
  icon?: IntegrationNavIcon;
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

/** What the rail is about: the platform, or one game. */
interface RailScope {
  id: string;
  label: string;
  hint: string;
  /** The game's monogram; the platform shows the app's icon. */
  mark: string | null;
  groups: RailGroup[];
}

/** The platform's icon, or the game's monogram. */
function ScopeMark({ of, size }: { of: RailScope; size: number }) {
  return of.mark === null ? (
    <Box
      component="img"
      src="/icon.svg"
      alt=""
      sx={{ width: size, height: size, borderRadius: '6px', flex: 'none' }}
    />
  ) : (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '6px',
        display: 'grid',
        placeItems: 'center',
        bgcolor: color.paper3,
        color: color.ink,
        fontFamily: fontMono,
        fontSize: size * 0.38,
        fontWeight: 600,
      }}
    >
      {of.mark}
    </Box>
  );
}

/**
 * The admin menu, beside every admin page's content (`Layout`). A dropdown at
 * the top picks what it is about: the platform (tournaments, people, the
 * site's own settings) or one installed game (its own pages, CS2: Servers,
 * Maps, Skins, Match rules). The rail lists only that one's pages, and opens
 * on whichever holds the current page.
 *
 * Running one tournament (needs you, matches, bracket, its setup) is not
 * here: it is the tournament's own bar over those pages (`TournamentBar`).
 *
 * A game's pages come from its module's `navItems`, labelled from its own
 * strings; core names none of them. A game with no pages is left out.
 */
export const ManageRail: React.FC = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isDevelopment = useIsDevelopment();
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);

  const platform: RailScope = {
    id: 'platform',
    label: t('managePage.rail.scope.platform'),
    hint: t('managePage.rail.scope.platformHint'),
    mark: null,
    groups: [
      {
        key: 'tournament',
        label: t('managePage.rail.groups.tournament'),
        items: [
          {
            key: 'tournaments',
            label: t('managePage.rail.allTournaments'),
            to: paths.tournaments,
            icon: ListBulletsIcon,
          },
          {
            key: 'playedMatches',
            label: t('managePage.rail.playedMatches'),
            to: paths.playedMatches,
            icon: FilmStripIcon,
          },
        ],
      },
      {
        key: 'people',
        label: t('managePage.rail.groups.people'),
        items: [
          {
            key: 'teams',
            label: t('managePage.rail.teams'),
            to: paths.teams,
            icon: UsersThreeIcon,
          },
          {
            key: 'players',
            label: t('managePage.rail.players'),
            to: paths.players,
            icon: UserIcon,
          },
          {
            key: 'reports',
            label: t('managePage.rail.reports'),
            to: paths.reports,
            icon: FlagIcon,
          },
        ],
      },
      {
        key: 'configuration',
        label: t('managePage.rail.groups.configuration'),
        items: [
          {
            key: 'templates',
            label: t('managePage.rail.templates'),
            to: paths.templates,
            icon: StackIcon,
          },
          {
            key: 'ratings',
            label: t('managePage.rail.ratings'),
            to: paths.eloTemplates,
            icon: ChartLineUpIcon,
          },
          {
            key: 'modules',
            label: t('managePage.rail.modules'),
            to: paths.modules,
            icon: PuzzlePieceIcon,
          },
        ],
      },
      {
        key: 'site',
        label: t('managePage.rail.groups.site'),
        items: [
          {
            key: 'settings',
            label: t('managePage.rail.settings'),
            to: paths.settings,
            icon: GearIcon,
          },
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
    ],
  };
  // One scope per installed game with pages of its own, named by it.
  const games: RailScope[] = listIntegrations()
    .filter((integration) => integration.navItems.length > 0)
    .map((integration) => {
      const label = t('managePage.rail.group', {
        ns: integration.id,
        defaultValue: t('managePage.rail.groups.game'),
      });
      return {
        id: integration.id,
        label,
        hint: t('managePage.rail.scope.gameHint'),
        mark: gameMonogram(label),
        groups: [
          {
            key: 'game',
            label,
            items: moduleNavItems([integration]).map((item) => ({
              key: item.key,
              label: navItemLabel(t, item, 'rail'),
              to: item.path,
              icon: item.icon,
            })),
          },
        ],
      };
    });
  const scopes = [platform, ...games];
  const scopeOfPath =
    scopes.find((scope) =>
      scope.groups.some((group) =>
        group.items.some((item) => !item.external && isCurrent(pathname, item.to))
      )
    ) ?? platform;
  // Picked by hand until the next page opens; then the page's own scope.
  const [picked, setPicked] = React.useState<{ id: string; at: string } | null>(null);
  const scope = (picked?.at === pathname && scopes.find((s) => s.id === picked.id)) || scopeOfPath;
  const groups = scope.groups.filter((group) => group.items.length > 0);

  const pickScope = (next: RailScope) => {
    setMenuAnchor(null);
    setPicked({ id: next.id, at: pathname });
    // Straight to the scope's first page when the current one is not in it.
    const first = next.groups.flatMap((g) => g.items).find((item) => !item.external);
    if (next.id !== scopeOfPath.id && first) navigate(first.to);
  };

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
        // plain list, as in the draft: no box around it. Each item has an
        // icon (the owner's call after the draft, which had none).
        ...railColumnSx,
        // The whole column, the tournament picker with it, fits the window;
        // the list under the picker scrolls in what is left.
        [RAIL_COLUMN_MIN_WIDTH]: {
          ...railColumnSx[RAIL_COLUMN_MIN_WIDTH],
          display: 'flex',
          flexDirection: 'column',
          maxHeight: `calc(100vh - ${BELOW_NAV_STICKY_TOP} - 24px)`,
        },
        fontSize: textSize.sm,
      }}
    >
      <ButtonBase
        onClick={(e) => setMenuAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={menuAnchor ? 'true' : undefined}
        aria-controls={menuAnchor ? 'manage-rail-scopes' : undefined}
        data-testid="manage-rail-scope"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          mb: 1.5,
          px: 1.25,
          py: 1,
          minWidth: { xs: 200, md: 0 },
          flex: 'none',
          textAlign: 'left',
          borderRadius: radii.sm,
          border: `1px solid ${color.rule}`,
          '&:hover': { bgcolor: color.paper2 },
          '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
        }}
      >
        <ScopeMark of={scope} size={28} />
        <Box component="span" sx={{ display: 'grid', minWidth: 0, flex: 1 }}>
          <Box
            component="span"
            sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}
          >
            {t('managePage.rail.scope.label')}
          </Box>
          <Box
            component="span"
            data-testid="manage-rail-scope-name"
            sx={{
              fontWeight: 600,
              color: color.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {scope.label}
          </Box>
        </Box>
        <CaretUpDownIcon
          aria-hidden
          size={ICON_SIZE.sm}
          style={{ flex: 'none', color: color.muted }}
        />
      </ButtonBase>
      <Menu
        id="manage-rail-scopes"
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 240, mt: 0.75, borderRadius: radii.md } } }}
      >
        {scopes.map((option) => (
          <MenuItem
            key={option.id}
            selected={option.id === scope.id}
            onClick={() => pickScope(option)}
            data-testid={`manage-rail-scope-${option.id}`}
            sx={{ gap: 1.25, py: 1 }}
          >
            <ScopeMark of={option} size={26} />
            <Box sx={{ display: 'grid', minWidth: 0 }}>
              <Box component="span" sx={{ fontWeight: 600, fontSize: textSize.sm }}>
                {option.label}
              </Box>
              <Box component="span" sx={{ fontSize: textSize.xs, color: color.muted }}>
                {option.hint}
              </Box>
            </Box>
          </MenuItem>
        ))}
      </Menu>
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
            flex: '1 1 auto',
            minHeight: 0,
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
                const Icon = item.icon;
                const linkProps = item.external
                  ? {
                      component: 'a' as const,
                      href: item.to,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    }
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
                    <Box
                      component="span"
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
                    >
                      {Icon && (
                        <Box
                          component="span"
                          data-testid={`manage-rail-${item.key}-icon`}
                          data-weight={selected ? 'fill' : 'regular'}
                          sx={{
                            display: 'inline-flex',
                            flex: 'none',
                            // Sized here as well as by `size`, so a module's
                            // icon that ignores `size` (an MUI one) fits too.
                            '& > svg': { width: ICON_SIZE.md, height: ICON_SIZE.md },
                          }}
                        >
                          <Icon
                            size={ICON_SIZE.md}
                            weight={selected ? 'fill' : 'regular'}
                            aria-hidden
                          />
                        </Box>
                      )}
                      {item.label}
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
