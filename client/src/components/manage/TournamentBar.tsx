import { Box } from '@mui/material';
import {
  GlobeIcon,
  ScalesIcon,
  SwordIcon,
  TreeStructureIcon,
  TrophyIcon,
} from '@phosphor-icons/react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOptionalAdminTournament } from '../../contexts/AdminTournamentContext';
import { useDisputesEntry } from '../../hooks/useDisputesEntry';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { manageTournamentPath, paths, type ManageTournamentTab } from '../../paths';
import { tokens, textSize } from '../../theme/tokens';
import { ICON_SIZE } from '../../theme/icons';

const { color } = tokens;

/** One tournament's pages in Manage: `/manage/tournaments/<id>/<tab>`. */
const SCOPED = /^\/manage\/tournaments\/(new|\d+)\/(matches|bracket|disputes|setup)\/?$/;

/** The pages that run one tournament: the bar shows over each of them. */
export function isTournamentPage(pathname: string): boolean {
  return SCOPED.test(pathname);
}

/**
 * Running one tournament (the Manage and ManageMatches boards): a crumb back
 * to all tournaments with this one's name, then its pages as tabs: Matches,
 * Bracket, Disputes (where a result can be argued about), Setup and its
 * public page. Which tournament is in the address; the rail lists the ones
 * being run, All tournaments the rest.
 */
export function TournamentBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const admin = useOptionalAdminTournament();
  const { tournamentId } = useShellIntegrations();
  const { show: showDisputes } = useDisputesEntry();
  const scoped = SCOPED.exec(pathname);
  const scopeId: number | 'new' | null = scoped
    ? scoped[1] === 'new'
      ? 'new'
      : Number(scoped[1])
    : tournamentId;
  const tabPath = (tab: ManageTournamentTab) =>
    scopeId === null ? paths.tournaments : manageTournamentPath(scopeId, tab);
  const name =
    scopeId === 'new'
      ? t('managePage.rail.newTournament')
      : (admin?.tournaments.find((x) => x.id === scopeId)?.name ?? '');

  const tabs = [
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
      label: t('managePage.rail.setupTab'),
      to: tabPath('setup'),
      icon: TrophyIcon,
    },
    ...(typeof scopeId === 'number'
      ? [
          {
            key: 'publicPage',
            label: t('managePage.rail.publicPage'),
            to: paths.tournamentOverview.replace(':id', String(scopeId)),
            icon: GlobeIcon,
          },
        ]
      : []),
  ];

  return (
    <Box
      component="nav"
      aria-label={t('managePage.rail.tournamentBar')}
      data-testid="tournament-bar"
      sx={{ display: 'grid', gap: 1.5, mb: 3 }}
    >
      <Box
        data-testid="tournament-bar-crumb"
        sx={{ fontSize: textSize.sm, color: color.muted, display: 'flex', gap: 0.75, minWidth: 0 }}
      >
        <Box
          component={RouterLink}
          to={paths.tournaments}
          sx={{ color: 'inherit', '&:hover': { color: color.ink } }}
        >
          {t('managePage.rail.allTournaments')}
        </Box>
        <span aria-hidden>/</span>
        <Box
          component="span"
          sx={{
            color: color.ink2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          overflowX: 'auto',
          overflowY: 'hidden',
          minWidth: 0,
          borderBottom: `1px solid ${color.rule}`,
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
                px: 2,
                py: 1.5,
                mb: '-1px',
                borderBottom: `2px solid ${selected ? color.accent : 'transparent'}`,
                color: selected ? color.ink : color.ink2,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                fontSize: textSize.md,
                fontWeight: 500,
                '&:hover': { color: color.ink },
                '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
              }}
            >
              <Icon aria-hidden size={ICON_SIZE.sm} weight={selected ? 'fill' : 'regular'} />
              {tab.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
