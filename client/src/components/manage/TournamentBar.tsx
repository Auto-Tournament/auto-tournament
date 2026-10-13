import { Box, MenuItem, TextField } from '@mui/material';
import {
  BellIcon,
  GlobeIcon,
  ScalesIcon,
  SwordIcon,
  TreeStructureIcon,
  TrophyIcon,
} from '@phosphor-icons/react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOptionalAdminTournament } from '../../contexts/AdminTournamentContext';
import { useManageRailCounts } from '../../contexts/ManageRailContext';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { manageTournamentPath, paths, type ManageTournamentTab } from '../../paths';
import { tokens, fontMono, radii, textSize } from '../../theme/tokens';
import { ICON_SIZE } from '../../theme/icons';

const { color } = tokens;

/** One tournament's pages in Manage: `/manage/tournaments/<id>/<tab>`. */
const SCOPED = /^\/manage\/tournaments\/(new|\d+)\/(matches|bracket|disputes|setup)\/?$/;

/** The pages that run one tournament: the bar shows over each of them (and over Needs you). */
export function isTournamentPage(pathname: string): boolean {
  return pathname === paths.manage || SCOPED.test(pathname);
}

/** The tab of a scoped tournament page, or null on another page. */
function scopedTab(pathname: string): ManageTournamentTab | null {
  const m = SCOPED.exec(pathname);
  return m ? (m[2] as ManageTournamentTab) : null;
}

/**
 * Running one tournament: which one (several can exist), and its pages as
 * tabs: Needs you, Matches, Bracket, Disputes (where a result can be argued
 * about), its setup and its public page. Over those pages, in place of the
 * rail, which is about the platform or a game.
 */
export function TournamentBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const admin = useOptionalAdminTournament();
  const { tournamentId } = useShellIntegrations();
  const { show: showDisputes } = useDisputesEntry();
  const { needsYouCount } = useManageRailCounts();
  const navigate = useNavigate();
  // The tournament the tabs open: the one picked, or the one being created.
  // With none yet, the tabs open the one about to be created.
  const scopeId: number | 'new' | null = admin
    ? admin.selectedId !== null && admin.selectedId !== admin.nextId
      ? admin.selectedId
      : admin.nextId !== null
        ? 'new'
        : null
    : tournamentId;
  const tabPath = (tab: ManageTournamentTab) =>
    scopeId === null ? paths.tournaments : manageTournamentPath(scopeId, tab);

  const tabs = [
    {
      key: 'needsYou',
      label: t('managePage.rail.needsYou'),
      to: paths.manage,
      icon: BellIcon,
      count: needsYouCount,
    },
    {
      key: 'matches',
      label: t('managePage.rail.matches'),
      to: tabPath('matches'),
      icon: SwordIcon,
    },
    {
      key: 'bracket',
      label: t('managePage.rail.bracket'),
      to: tabPath('bracket'),
      icon: TreeStructureIcon,
    },
    ...(showDisputes
      ? [
          {
            key: 'disputes',
            label: t('managePage.rail.disputes'),
            to: tabPath('disputes'),
            icon: ScalesIcon,
          },
        ]
      : []),
    {
      key: 'tournament',
      label: t('managePage.rail.tournament'),
      to: tabPath('setup'),
      icon: TrophyIcon,
    },
    ...(tournamentId !== null
      ? [
          {
            key: 'publicPage',
            label: t('managePage.rail.publicPage'),
            to: paths.tournamentOverview.replace(':id', String(tournamentId)),
            icon: GlobeIcon,
          },
        ]
      : []),
  ];

  const switcher =
    admin && (admin.tournaments.length > 0 || admin.selectedId !== null)
      ? (() => {
          const { tournaments, selectedId, nextId, select } = admin;
          const isNew =
            selectedId !== null &&
            selectedId === nextId &&
            !tournaments.some((x) => x.id === selectedId);
          return (
            <TextField
              select
              size="small"
              label={t('managePage.rail.switcher')}
              value={selectedId ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                // On one of its pages, the same page of the other tournament.
                const tab = scopedTab(pathname);
                if (tab) navigate(manageTournamentPath(id === nextId ? 'new' : id, tab));
                else select(id);
              }}
              inputProps={{ 'data-testid': 'tournament-switcher' }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 420 } } } }}
              sx={{ minWidth: 220, maxWidth: '100%' }}
            >
              {tournaments
                .filter((x) => !x.archived || x.id === selectedId)
                .map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.name}
                  </MenuItem>
                ))}
              {isNew && (
                <MenuItem value={selectedId}>{t('managePage.rail.newTournament')}</MenuItem>
              )}
            </TextField>
          );
        })()
      : null;

  return (
    <Box
      component="nav"
      aria-label={t('managePage.rail.tournamentBar')}
      data-testid="tournament-bar"
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 3 }}
    >
      {switcher}
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          overflowX: 'auto',
          minWidth: 0,
          flex: '1 1 auto',
          py: 0.5,
        }}
      >
        {tabs.map((tab) => {
          const selected = pathname === tab.to;
          const Icon = tab.icon;
          return (
            <Box
              key={tab.key}
              component={RouterLink}
              to={tab.to}
              data-testid={`tournament-bar-${tab.key}`}
              aria-current={selected ? 'page' : undefined}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                flex: 'none',
                px: 1.5,
                py: 0.75,
                borderRadius: radii.pill,
                border: `1px solid ${selected ? color.ink2 : color.rule}`,
                bgcolor: selected ? color.paper2 : 'transparent',
                color: selected ? color.ink : color.ink2,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                fontSize: textSize.sm,
                '&:hover': { color: color.ink, bgcolor: color.paper2 },
                '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
              }}
            >
              <Icon aria-hidden size={ICON_SIZE.sm} weight={selected ? 'fill' : 'regular'} />
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <Box
                  component="span"
                  data-testid={`tournament-bar-${tab.key}-count`}
                  sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.accent }}
                >
                  {tab.count}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
