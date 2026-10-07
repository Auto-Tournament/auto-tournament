import { Box, MenuItem, TextField } from '@mui/material';
import {
  BellIcon,
  GlobeIcon,
  ScalesIcon,
  SwordIcon,
  TreeStructureIcon,
  TrophyIcon,
} from '@phosphor-icons/react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOptionalAdminTournament } from '../../contexts/AdminTournamentContext';
import { useManageRailCounts } from '../../contexts/ManageRailContext';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { paths } from '../../paths';
import { tokens, fontMono, radii, textSize } from '../../theme/tokens';
import { ICON_SIZE } from '../../theme/icons';

const { color } = tokens;

/** The pages that run one tournament: the bar shows over each of them. */
export const TOURNAMENT_PAGES = [paths.manage, paths.matches, paths.bracket, paths.disputes];

export function isTournamentPage(pathname: string): boolean {
  return TOURNAMENT_PAGES.some((to) => pathname === to || pathname.startsWith(`${to}/`));
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

  const tabs = [
    {
      key: 'needsYou',
      label: t('managePage.rail.needsYou'),
      to: paths.manage,
      icon: BellIcon,
      count: needsYouCount,
    },
    { key: 'matches', label: t('managePage.rail.matches'), to: paths.matches, icon: SwordIcon },
    {
      key: 'bracket',
      label: t('managePage.rail.bracket'),
      to: paths.bracket,
      icon: TreeStructureIcon,
    },
    ...(showDisputes
      ? [
          {
            key: 'disputes',
            label: t('managePage.rail.disputes'),
            to: paths.disputes,
            icon: ScalesIcon,
          },
        ]
      : []),
    {
      key: 'tournament',
      label: t('managePage.rail.tournament'),
      to: paths.tournament,
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
              onChange={(e) => select(Number(e.target.value))}
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
