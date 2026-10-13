import { useEffect, useMemo, useState } from 'react';
import { Box, Button, ButtonBase, Checkbox, InputBase } from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { getRoundLabel } from '../../utils/matchUtils';
import { radii, textSize, tokens } from '../../theme/tokens';
import { ManageCard, ManageTable, LevelText } from './ManageTable';
import type { Match } from '../../types';
import type { AdminCall } from '../../types/adminCall';

const { color } = tokens;

type Filter = 'attention' | 'live' | 'veto' | 'waiting' | 'finished' | 'all';

export interface MatchesTableProps {
  live: Match[];
  upcoming: Match[];
  history: Match[];
  /** The match's number across the tournament ("#3"). */
  numberOf: (match: Match) => number;
  /** The latest event from the server, per live match. */
  latestEvent: (match: Match) => string | null;
  onOpen: (match: Match) => void;
  /** Bulk select (manual matches): the checkbox column shows while on. */
  selection?: {
    can: (match: Match) => boolean;
    has: (match: Match) => boolean;
    toggle: (match: Match) => void;
  } | null;
}

/**
 * Every match of the tournament as one table (the ManageMatches board):
 * filters with counts (Needs attention first), a search by team or player,
 * then where it sits in the bracket, the teams, its phase, its server and
 * what needs an admin. A row opens the admin match page.
 */
export function MatchesTable({
  live,
  upcoming,
  history,
  numberOf,
  latestEvent,
  onOpen,
  selection,
}: MatchesTableProps) {
  const { t } = useTranslation();
  const [calls, setCalls] = useState<AdminCall[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .get<{ open?: AdminCall[] }>('/api/admin-calls?resolvedWithin=0')
      .then((res) => setCalls(res.open ?? []))
      .catch(() => setCalls([]));
  }, [live.length, upcoming.length, history.length]);

  const attentionOf = (match: Match): string | null => {
    const call = calls.filter((c) => c.matchSlug === match.slug).length;
    if (call > 0) return t('matchesPage.table.attention.calls', { count: call });
    if ((match.status as string) === 'needs_decision')
      return t('matchesPage.table.attention.decide');
    return null;
  };

  const vetoing = (m: Match) =>
    (m.status === 'pending' || m.status === 'ready') &&
    m.vetoCompleted === false &&
    Boolean(m.team1 && m.team2);
  const all = useMemo(() => [...live, ...upcoming, ...history], [live, upcoming, history]);
  const counts: Record<Filter, number> = {
    attention: all.filter((m) => attentionOf(m) !== null).length,
    live: live.length,
    veto: upcoming.filter(vetoing).length,
    waiting: upcoming.filter((m) => !vetoing(m)).length,
    finished: history.length,
    all: all.length,
  };
  const [filter, setFilter] = useState<Filter | null>(null);
  // Needs attention first when there is any, otherwise every match.
  const active: Filter = filter ?? (counts.attention > 0 ? 'attention' : 'all');

  const inFilter = (m: Match): boolean => {
    switch (active) {
      case 'attention':
        return attentionOf(m) !== null;
      case 'live':
        return live.includes(m);
      case 'veto':
        return upcoming.includes(m) && vetoing(m);
      case 'waiting':
        return upcoming.includes(m) && !vetoing(m);
      case 'finished':
        return history.includes(m);
      default:
        return true;
    }
  };
  const q = query.trim().toLowerCase();
  const matchesQuery = (m: Match): boolean => {
    if (!q) return true;
    const names = [
      m.team1?.name,
      m.team2?.name,
      ...(m.config?.team1?.players ?? []).map((p) => p.name),
      ...(m.config?.team2?.players ?? []).map((p) => p.name),
    ];
    return names.some((n) => n?.toLowerCase().includes(q));
  };
  const rows = all.filter((m) => inFilter(m) && matchesQuery(m));

  const teamsOf = (m: Match) =>
    `${m.team1?.name ?? m.config?.team1?.name ?? t('matchesPage.table.tbd')} vs ${
      m.team2?.name ?? m.config?.team2?.name ?? t('matchesPage.table.tbd')
    }`;
  const phaseOf = (m: Match): { text: string; tone: 'ok' | 'warn' | 'muted' | 'info' } => {
    if (live.includes(m)) {
      const map = typeof m.mapNumber === 'number' ? m.mapNumber + 1 : 1;
      const score =
        typeof m.team1MapScore === 'number' && typeof m.team2MapScore === 'number'
          ? ` · ${m.team1MapScore}–${m.team2MapScore}`
          : '';
      const event = latestEvent(m);
      return {
        text: `${t('matchesPage.table.phase.live', { map })}${score}${event ? ` · ${event}` : ''}`,
        tone: 'ok',
      };
    }
    if (history.includes(m)) {
      const s1 = m.team1SeriesScore ?? m.team1Score;
      const s2 = m.team2SeriesScore ?? m.team2Score;
      return {
        text:
          typeof s1 === 'number' && typeof s2 === 'number'
            ? t('matchesPage.table.phase.finishedScore', { score: `${s1}–${s2}` })
            : t('matchesPage.table.phase.finished'),
        tone: 'muted',
      };
    }
    if (vetoing(m)) return { text: t('matchesPage.table.phase.veto'), tone: 'warn' };
    if (!m.team1 || !m.team2)
      return { text: t('matchesPage.table.phase.waitingTeams'), tone: 'muted' };
    if (typeof m.queuePosition === 'number')
      return {
        text: t('matchesPage.table.phase.queued', { position: m.queuePosition }),
        tone: 'info',
      };
    return { text: t('matchesPage.table.phase.waiting'), tone: 'muted' };
  };

  const filters: Filter[] = ['attention', 'live', 'veto', 'waiting', 'finished', 'all'];

  return (
    <ManageCard data-testid="matches-list" sx={{ p: { xs: 1.5, md: 2 } }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box
          role="group"
          aria-label={t('matchesPage.table.filterLabel')}
          sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}
        >
          {filters.map((key) => {
            const on = key === active;
            return (
              <ButtonBase
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={on}
                data-testid={`matches-filter-${key}`}
                sx={{
                  px: 1.5,
                  height: 34,
                  borderRadius: radii.pill,
                  border: `1px solid ${on ? color.accent : color.rule}`,
                  bgcolor: on ? color.accent : 'transparent',
                  color: on ? color.paper : color.ink2,
                  fontSize: textSize.sm,
                  fontWeight: 600,
                  '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                }}
              >
                {t(`matchesPage.table.filter.${key}`, { count: counts[key] })}
              </ButtonBase>
            );
          })}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            height: 36,
            minWidth: { xs: '100%', sm: 260 },
            borderRadius: radii.sm,
            border: `1px solid ${color.rule}`,
            color: color.muted,
          }}
        >
          <MagnifyingGlassIcon size={16} aria-hidden />
          <InputBase
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('matchesPage.table.search')}
            inputProps={{
              'aria-label': t('matchesPage.table.search'),
              'data-testid': 'matches-search',
            }}
            sx={{ flex: 1, fontSize: textSize.sm }}
          />
        </Box>
      </Box>
      <ManageTable
        label={t('layout.pageTitle.matches')}
        columns={[
          ...(selection
            ? [{ key: 'select', label: t('matchesPage.bulkSelect.select'), hidden: true }]
            : []),
          { key: 'match', label: t('matchesPage.table.columns.match') },
          { key: 'teams', label: t('matchesPage.table.columns.teams') },
          { key: 'phase', label: t('matchesPage.table.columns.phase') },
          { key: 'server', label: t('matchesPage.table.columns.server') },
          { key: 'attention', label: t('matchesPage.table.columns.attention') },
          { key: 'open', label: t('matchesPage.table.columns.open'), hidden: true },
        ]}
        empty={t('matchesPage.table.empty')}
        rows={rows.map((m) => {
          const phase = phaseOf(m);
          const attention = attentionOf(m);
          const selectable = selection?.can(m) ?? false;
          return {
            key: m.slug || String(m.id),
            testId: `matches-row-${m.slug}`,
            cells: [
              ...(selection
                ? [
                    selectable ? (
                      <Checkbox
                        key="s"
                        size="small"
                        checked={selection.has(m)}
                        onChange={() => selection.toggle(m)}
                        inputProps={{ 'aria-label': teamsOf(m) }}
                      />
                    ) : (
                      <span key="s" />
                    ),
                  ]
                : []),
              <Box key="m" sx={{ display: 'grid', gap: 0.25 }}>
                <span>{getRoundLabel(m.round)}</span>
                <Box component="span" sx={{ color: color.muted, fontSize: textSize.xs }}>
                  #{numberOf(m)}
                </Box>
              </Box>,
              <strong key="t">{teamsOf(m)}</strong>,
              <LevelText key="p" tone={phase.tone}>
                {phase.text}
              </LevelText>,
              <Box
                key="sv"
                component="span"
                sx={{ color: m.serverName ? color.ink2 : color.muted }}
              >
                {m.serverName ?? (history.includes(m) ? t('matchesPage.table.server.freed') : '—')}
              </Box>,
              attention ? (
                <LevelText key="a" tone="error">
                  {attention}
                </LevelText>
              ) : (
                <Box key="a" component="span" sx={{ color: color.muted }}>
                  —
                </Box>
              ),
              <Box key="o" sx={{ textAlign: 'right' }}>
                <Button
                  size="small"
                  variant={attention ? 'contained' : 'outlined'}
                  onClick={() => onOpen(m)}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {t('matchesPage.table.manage')}
                </Button>
              </Box>,
            ],
          };
        })}
      />
    </ManageCard>
  );
}
