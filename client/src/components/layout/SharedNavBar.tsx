import React from 'react';
import { Box, Button, Link, Menu, MenuItem } from '@mui/material';
import { CaretDownIcon, GameControllerIcon } from '@phosphor-icons/react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useCurrentMatchStatus } from '../../hooks/useCurrentMatchStatus';
import { DevAccountSwitcherGate } from '../dev/DevAccountSwitcherGate';
import { AtIcon } from '../common/AtIcon';
import { fontDisplay, radii, textSize, tokens } from '../../theme/tokens';
import { matchPagePath, paths } from '../../paths';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { NotificationBell } from '../social/NotificationBell';
import { AdminNoticeBell } from '../admin/AdminNoticeBell';
import { useNeedsYouCount } from '../../hooks/useNeedsYouCount';
import { AccountMenu } from './AccountMenu';
import { SiteSearch } from '../search/SiteSearch';
import { useInstalledIntegrations } from '../../integrations/registry';
import { soundNotification } from '../../utils/soundNotification';
import { NextMatchDialog } from '../match/NextMatchDialog';
import { NavStartCountdown } from './NavStartCountdown';
import { NavVetoCountdown } from './NavVetoCountdown';
import { NavTournamentStatus } from './NavTournamentStatus';
import { PlacementDialog } from '../tournament/PlacementDialog';

/** Top-bar text links: ink2 at rest, ink on hover and on the current page (the drafts' `.nav-links`). */
const navLinkSx = {
  color: 'text.secondary',
  fontWeight: 500,
  fontSize: textSize.sm,
  px: 1.25,
  minWidth: 0,
  whiteSpace: 'nowrap',
  '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
} as const;

type SiteLink = { to: string; label: string; testId: string; current: boolean };

/**
 * Matches whose "ready" toast this tab already showed. Kept in sessionStorage
 * so a page change (the navbar remounts) or a reload does not toast again.
 */
const MATCH_READY_STORAGE_KEY = 'at.matchReadyAnnounced';
let matchReadyAnnouncedFallback: string | null = null;

function wasMatchReadyAnnounced(slug: string): boolean {
  try {
    return window.sessionStorage.getItem(MATCH_READY_STORAGE_KEY) === slug;
  } catch {
    return matchReadyAnnouncedFallback === slug;
  }
}

function markMatchReadyAnnounced(slug: string): void {
  matchReadyAnnouncedFallback = slug;
  try {
    window.sessionStorage.setItem(MATCH_READY_STORAGE_KEY, slug);
  } catch {
    // Storage blocked: the in-memory value still covers page changes.
  }
}

interface SharedNavBarProps {
  /**
   * Set by the admin shell on the pages its rail lists, so "Manage" reads as
   * where the admin is.
   */
  adminArea?: boolean;
}

/**
 * What goes inside the top bar (`TopNavBar`, the pill): the logo, the site
 * links for the viewer's role, and the account menu, which also holds the
 * theme and language pickers.
 *
 * Links follow the IA drafts (2026-10): Play, Tournaments, Leaderboards and a
 * Community menu for everyone, Manage for an admin; the logo is Home. The
 * match pill opens the viewer's match room.
 */
export const SharedNavBar: React.FC<SharedNavBarProps> = ({ adminArea = false }) => {
  const { playerSteamId, isAuthenticated, needsSteamLink, loginWithSteam, impersonation } =
    useAuth();
  const { t } = useTranslation();
  const {
    status: matchStatus,
    matchSlug,
    matchName,
    label: matchStatusLabel,
    loading: matchStatusLoading,
    viewerTeam,
    vetoActionCount,
    lastVetoActionTeam,
    opensAt,
    vetoOff,
    matchup,
  } = useCurrentMatchStatus(playerSteamId ?? null);
  const { showSnackbar, closeSnackbar } = useSnackbar();

  // Below `md` the site links do not fit next to the account button, so they
  // fold into one menu there.
  const [siteMenuAnchor, setSiteMenuAnchor] = React.useState<null | HTMLElement>(null);
  // Community: the directories and the modules' pages, behind one word.
  const [communityAnchor, setCommunityAnchor] = React.useState<null | HTMLElement>(null);
  const location = useLocation();
  const prevMatchRef = React.useRef<{
    status: string;
    label: string | null;
    vetoActionCount: number | null;
  } | null>(null);

  // The admin links are for a real admin session only. While impersonating,
  // the UI behaves as the player and shows the player's links.
  const showAdminLinks = isAuthenticated && !impersonation;
  // Things waiting for an admin, site-wide: the pill opens Needs you.
  const needsYou = useNeedsYouCount(showAdminLinks);

  React.useEffect(() => {
    if (!playerSteamId) {
      prevMatchRef.current = null;
      return;
    }
    if (matchStatusLoading) return;
    const prev = prevMatchRef.current;
    const now = { status: matchStatus, label: matchStatusLabel, vetoActionCount };
    // A new veto action landed since the last status we saw. Only credit the
    // opponent when the latest action was actually made by the other team —
    // after the viewer's own ban/pick/side pick the label also flips to
    // "waiting", which previously produced a bogus "opponent moved" toast.
    const newVetoAction =
      prev !== null &&
      typeof prev.vetoActionCount === 'number' &&
      typeof now.vetoActionCount === 'number' &&
      now.vetoActionCount > prev.vetoActionCount;
    const opponentActed =
      newVetoAction && !!viewerTeam && !!lastVetoActionTeam && lastVetoActionTeam !== viewerTeam;
    const labelChanged = !!prev && (prev.status !== now.status || prev.label !== now.label);
    if (prev && (labelChanged || (opponentActed && now.label === 'waiting_veto'))) {
      const msg =
        now.label === 'your_turn_veto'
          ? t('nav.matchStatus.yourTurnVeto')
          : now.label === 'waiting_veto' && opponentActed
            ? t('nav.matchStatus.snackbarOpponentMoved')
            : now.label === 'waiting_veto'
              ? t('nav.matchStatus.waitingVeto')
              : now.label === 'waiting_server'
                ? t('nav.matchStatus.waitingServer')
                : null;
      if (msg) {
        showSnackbar(msg, 'info');
      }
    }
    prevMatchRef.current = now;
  }, [
    playerSteamId,
    matchStatusLoading,
    matchStatus,
    matchStatusLabel,
    vetoActionCount,
    viewerTeam,
    lastVetoActionTeam,
    showSnackbar,
    t,
  ]);

  // "Match ready": one toast per match, with the match name and a link to the
  // player's page (where the connect button is). It stays until dismissed and
  // is not repeated on every page change (the navbar mounts per page), and the
  // ready sound plays with it, whatever page the player is on.
  const readyToastKey = matchSlug ? `match-ready-${matchSlug}` : null;
  React.useEffect(() => {
    if (!playerSteamId || matchStatusLoading || !matchSlug || !readyToastKey) return;
    if (matchStatus !== 'match_ready') {
      closeSnackbar(readyToastKey);
      return;
    }
    if (wasMatchReadyAnnounced(matchSlug)) return;
    markMatchReadyAnnounced(matchSlug);
    showSnackbar(
      <span>
        {matchName
          ? t('nav.matchStatus.matchReadyNamed', { match: matchName })
          : t('nav.matchStatus.matchReady')}{' '}
        <Link
          component={RouterLink}
          to={paths.matchNow}
          onClick={() => closeSnackbar(readyToastKey)}
          sx={{ color: 'inherit', fontWeight: 600, textDecorationColor: 'currentColor' }}
          data-testid="match-ready-toast-link"
        >
          {t('nav.matchStatus.openMatch')}
        </Link>
      </span>,
      'success',
      { persist: true, key: readyToastKey }
    );
    soundNotification.playNotification();
  }, [
    playerSteamId,
    matchStatusLoading,
    matchStatus,
    matchSlug,
    matchName,
    readyToastKey,
    showSnackbar,
    closeSnackbar,
    t,
  ]);

  const ctaLabels: Record<string, string> = {
    your_turn_veto: t('nav.matchStatus.yourTurnVeto'),
    waiting_veto: t('nav.matchStatus.waitingVeto'),
    veto_soon: t('nav.matchStatus.vetoSoon', 'Veto soon'),
    waiting_server: t('nav.matchStatus.waitingServer'),
    match_ready: t('nav.matchStatus.matchReady'),
  };

  const { pathname } = location;
  const { available: matchmakingAvailable } = useMatchmaking();
  const at = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  // Modules' own pages for everyone (CS2: Highlights, every clip and reel).
  const moduleLinks: SiteLink[] = useInstalledIntegrations().flatMap((integration) =>
    (integration.siteNavLinks ?? []).map((link) => ({
      to: link.path,
      label: t(link.labelKey, { ns: integration.id }),
      testId: `nav-${integration.id}-${link.path.replace(/^\//, '').replace(/\W+/g, '-')}`,
      current: at(link.path),
    }))
  );
  // The places a player goes: Play, Tournaments, and Community for the
  // leaderboards, the directories and the modules' pages (fewer words in the bar).
  // The logo is Home. Admins also get Manage.
  const mainLinks: SiteLink[] = [
    ...(matchmakingAvailable
      ? [{ to: paths.play, label: t('nav.play'), testId: 'nav-play', current: at(paths.play) }]
      : []),
    {
      to: paths.tournamentList,
      label: t('nav.tournaments'),
      testId: 'nav-tournaments',
      current: at(paths.tournamentList) || pathname.startsWith('/tournament/'),
    },
  ];
  const communityLinks: SiteLink[] = [
    {
      to: paths.leaderboards,
      label: t('nav.leaderboards'),
      testId: 'nav-leaderboards',
      current: at(paths.leaderboards),
    },
    {
      to: paths.communityTeams,
      label: t('nav.teams'),
      testId: 'nav-community-teams',
      current: at(paths.communityTeams),
    },
    {
      to: paths.communityPlayers,
      label: t('nav.players'),
      testId: 'nav-community-players',
      current: at(paths.communityPlayers),
    },
    ...moduleLinks,
  ];
  const manageLinks: SiteLink[] = showAdminLinks
    ? [{ to: paths.manage, label: t('nav.manage'), testId: 'nav-manage', current: adminArea }]
    : [];
  // The phone menu lists them all, flat.
  const siteLinks: SiteLink[] = [...mainLinks, ...communityLinks, ...manageLinks];
  const communityCurrent = communityLinks.some((link) => link.current);

  const ctaLabel =
    playerSteamId && matchStatus !== 'none' && matchStatusLabel && ctaLabels[matchStatusLabel];

  return (
    <>
      <NextMatchDialog
        status={matchStatus}
        matchSlug={matchSlug}
        matchName={matchName}
        vetoActionCount={vetoActionCount}
        opensAt={opensAt}
        vetoOff={vetoOff}
        matchup={matchup}
        loading={matchStatusLoading}
      />
      {playerSteamId && !impersonation && <PlacementDialog viewerId={playerSteamId} />}
      <Box
        component={RouterLink}
        to={paths.root}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          textDecoration: 'none',
          color: 'text.primary',
          fontFamily: fontDisplay,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <Box
          sx={{
            height: 26,
            width: 26,
            flex: 'none',
            borderRadius: '7px',
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <AtIcon size={26} title="Auto Tournament" />
        </Box>
        <Box
          component="span"
          aria-hidden
          sx={{
            display: { xs: 'none', sm: 'inline' },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Auto Tournament
        </Box>
      </Box>

      <Box
        component="nav"
        aria-label={t('nav.siteMenu')}
        sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5, flexShrink: 0 }}
      >
        {mainLinks.map((link) => (
          <Button
            key={link.testId}
            color="inherit"
            component={RouterLink}
            to={link.to}
            size="small"
            sx={[navLinkSx, link.current && { color: 'text.primary' }]}
            aria-current={link.current ? 'page' : undefined}
            data-testid={link.testId}
          >
            {link.label}
          </Button>
        ))}
        <Button
          color="inherit"
          size="small"
          aria-haspopup="menu"
          aria-controls={communityAnchor ? 'community-nav-menu' : undefined}
          aria-expanded={communityAnchor ? 'true' : undefined}
          onClick={(event) => setCommunityAnchor(event.currentTarget)}
          endIcon={<CaretDownIcon size={14} aria-hidden />}
          sx={[navLinkSx, communityCurrent && { color: 'text.primary' }]}
          data-testid="nav-community"
        >
          {t('nav.community')}
        </Button>
        <Menu
          id="community-nav-menu"
          anchorEl={communityAnchor}
          open={Boolean(communityAnchor)}
          onClose={() => setCommunityAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {communityLinks.map((link) => (
            <MenuItem
              key={link.testId}
              component={RouterLink}
              to={link.to}
              selected={link.current}
              aria-current={link.current ? 'page' : undefined}
              onClick={() => setCommunityAnchor(null)}
              data-testid={link.testId}
            >
              {link.label}
            </MenuItem>
          ))}
        </Menu>
        {manageLinks.map((link) => (
          <Button
            key={link.testId}
            color="inherit"
            component={RouterLink}
            to={link.to}
            size="small"
            sx={[navLinkSx, link.current && { color: 'text.primary' }]}
            aria-current={link.current ? 'page' : undefined}
            data-testid={link.testId}
          >
            {link.label}
          </Button>
        ))}
      </Box>
      <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
        {/* A word, not a lone icon: says where you are and that it opens the site links. */}
        <Button
          color="inherit"
          size="small"
          aria-haspopup="menu"
          aria-controls={siteMenuAnchor ? 'site-nav-menu' : undefined}
          aria-expanded={siteMenuAnchor ? 'true' : undefined}
          onClick={(event) => setSiteMenuAnchor(event.currentTarget)}
          endIcon={<CaretDownIcon size={14} aria-hidden />}
          sx={[navLinkSx, { minHeight: 36 }]}
          data-testid="nav-site-menu-button"
        >
          {siteLinks.find((link) => link.current)?.label ?? t('nav.menu')}
        </Button>
        <Menu
          id="site-nav-menu"
          anchorEl={siteMenuAnchor}
          open={Boolean(siteMenuAnchor)}
          onClose={() => setSiteMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {siteLinks.map((link) => (
            <MenuItem
              key={link.testId}
              component={RouterLink}
              to={link.to}
              selected={link.current}
              aria-current={link.current ? 'page' : undefined}
              onClick={() => setSiteMenuAnchor(null)}
              data-testid={`${link.testId}-menu-item`}
            >
              {link.label}
            </MenuItem>
          ))}
        </Menu>
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {/* The break before the veto: the time, outlined (nothing to do yet). */}
        {playerSteamId && matchStatusLabel === 'veto_soon' && opensAt && matchSlug ? (
          <NavVetoCountdown opensAt={opensAt} to={matchPagePath(matchSlug)} vetoOff={vetoOff} />
        ) : ctaLabel ? (
          <Button
            component={RouterLink}
            to={paths.matchNow}
            variant="contained"
            color="primary"
            size="small"
            data-testid="nav-match-cta"
            startIcon={<GameControllerIcon />}
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, px: 2, whiteSpace: 'nowrap' }}
          >
            {ctaLabel}
          </Button>
        ) : playerSteamId ? (
          <>
            <NavStartCountdown viewerId={playerSteamId} />
            <NavTournamentStatus viewerId={playerSteamId} />
          </>
        ) : null}
        <DevAccountSwitcherGate />

        {needsSteamLink && (
          <Button color="warning" variant="outlined" onClick={loginWithSteam} size="small">
            {t('nav.linkSteam')}
          </Button>
        )}

        <SiteSearch />

        {showAdminLinks && needsYou > 0 && (
          <Button
            component={RouterLink}
            to={paths.manage}
            size="small"
            data-testid="nav-needs-you"
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              gap: 1,
              px: 1.75,
              borderRadius: radii.pill,
              border: `1px solid ${tokens.color.accent}`,
              color: tokens.color.ink,
              whiteSpace: 'nowrap',
              fontWeight: 600,
            }}
          >
            <Box
              component="span"
              sx={{
                minWidth: 22,
                height: 22,
                px: 0.5,
                borderRadius: '11px',
                bgcolor: tokens.color.accent,
                color: tokens.color.paper,
                fontSize: 12,
                lineHeight: '22px',
                textAlign: 'center',
              }}
            >
              {needsYou}
            </Box>
            {t('nav.needsYou')}
          </Button>
        )}
        {showAdminLinks && <AdminNoticeBell />}
        {playerSteamId && !impersonation && <NotificationBell viewerId={playerSteamId} />}

        <AccountMenu />
      </Box>
    </>
  );
};
