/**
 * Pure data-shaping helpers for the "Manage" console.
 *
 * Everything here derives from the matches the page already fetches
 * (GET /api/matches). What the tournament's game module knows about its own
 * resources (CS2: servers) it works out itself, from its own availability
 * answer (`summarizeAvailability`, `manageNeedsYou`), and the page passes the
 * results in. No new API calls are introduced by this module.
 */
import i18n from '../i18n';
import type { Match } from '../types/match.types';
import type {
  ManageMatchRef,
  ManageNeedsYouAction,
  ManageNeedsYouActionKind,
  ManageNeedsYouItem,
} from '../integrations/types';
import { getRoundLabel } from './matchUtils';

/** Mirrors the "does this match have real, assigned teams" check Matches.tsx uses. */
export function hasAssignedTeams(match: Match): boolean {
  if (match.round === 0) {
    const cfgTeam1Name = (match.config?.team1 as { name?: string } | undefined)?.name;
    const cfgTeam2Name = (match.config?.team2 as { name?: string } | undefined)?.name;
    return Boolean(
      cfgTeam1Name && cfgTeam1Name !== 'TBD' && cfgTeam2Name && cfgTeam2Name !== 'TBD'
    );
  }
  return Boolean(match.team1 && match.team2);
}

export interface ManageStatusCounts {
  live: number;
  inVeto: number;
  queued: number;
  /** Human label ("QF", "Round 3", ...), or null when there's no bracket round to show. */
  roundLabel: string | null;
}

/**
 * The strip's match counts. It no longer counts servers: how many of a game's
 * resources are free is the game's own tile (`manageStatusTile`), because a
 * game with none has no zero to show — it has nothing to show, and "0 / 0"
 * reads as an outage rather than as "not applicable".
 */
export function computeStatusCounts(
  matches: Match[],
  /** Matches waiting for a resource, from the module's `summarizeAvailability` (0 without one). */
  queued: number
): ManageStatusCounts {
  const live = matches.filter(
    (m) => (m.status === 'live' || m.status === 'loaded') && hasAssignedTeams(m)
  ).length;

  const inVeto = matches.filter(
    (m) =>
      (m.status === 'pending' || m.status === 'ready') &&
      m.vetoCompleted === false &&
      hasAssignedTeams(m)
  ).length;

  const bracketMatches = matches.filter((m) => m.round > 0);
  const maxRound = bracketMatches.reduce((max, m) => Math.max(max, m.round), 0);
  const unfinished = bracketMatches.filter(
    (m) => m.status !== 'completed' && m.status !== 'cancelled'
  );
  const currentRound =
    unfinished.length > 0 ? Math.min(...unfinished.map((m) => m.round)) : maxRound;
  const roundLabel = maxRound > 0 ? getRoundLabel(currentRound, maxRound) : null;

  return {
    live,
    inVeto,
    queued,
    roundLabel,
  };
}

// The queue's rows are part of the module contract, so a module can add its own.
export type NeedsYouActionKind = ManageNeedsYouActionKind;
export type NeedsYouAction = ManageNeedsYouAction;
export type NeedsYouItem = ManageNeedsYouItem;

function matchDisplayName(match: Match | undefined, slug: string): string {
  if (!match) return slug;
  const t1 = match.team1?.name ?? match.config?.team1?.name;
  const t2 = match.team2?.name ?? match.config?.team2?.name;
  if (t1 && t2) return i18n.t('managePage.needsYou.vsLabel', { team1: t1, team2: t2 });
  return slug;
}

/** The matches as a module's `manageNeedsYou` sees them: slug, status and a name to show. */
export function manageMatchRefs(matches: Match[]): ManageMatchRef[] {
  return matches.map((match) => ({
    slug: match.slug,
    status: match.status,
    name: matchDisplayName(match, match.slug),
  }));
}

/**
 * Build the "needs you" queue: matches stuck in `needs_decision` (out of
 * maps, still level), then whatever the tournament's module reports about its
 * own resources (CS2: servers offline, or flagged stale by the allocator,
 * while they hold a match).
 *
 * Each item's actions call the same endpoints AdminMatchControls uses
 * (`/winner`, `/reallocate`, `/force-cancel`).
 */
export function computeNeedsYouItems(
  matches: Match[],
  /** The module's rows, from its `manageNeedsYou`. */
  resourceItems: NeedsYouItem[] = []
): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const match of matches) {
    if ((match.status as string) !== 'needs_decision') continue;
    items.push({
      id: `decision-${match.slug}`,
      severity: 'warn',
      title: i18n.t('managePage.needsYou.decide.title', {
        teams: matchDisplayName(match, match.slug),
      }),
      detail: i18n.t('managePage.needsYou.decide.detail'),
      actions: [
        {
          kind: 'decide',
          label: i18n.t('managePage.needsYou.decide.action'),
          matchSlug: match.slug,
        },
      ],
      decisionMatchSlug: match.slug,
    });
  }

  return [...items, ...resourceItems];
}

export interface RecentEvent {
  id: string;
  title: string;
  detail: string;
  timestamp: number;
}

/**
 * Last ~8 meaningful events, derived entirely from matches already fetched
 * for the queue/status strip (completed_at + mapResults). There is no
 * timestamped log endpoint for veto completion or server-offline transitions,
 * so this intentionally covers map results and series completions only.
 */
export function computeRecentEvents(matches: Match[], limit = 8): RecentEvent[] {
  const events: RecentEvent[] = [];

  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const t1 = match.team1?.name ?? match.config?.team1?.name ?? i18n.t('managePage.recent.team1Fallback');
    const t2 = match.team2?.name ?? match.config?.team2?.name ?? i18n.t('managePage.recent.team2Fallback');

    for (const result of match.mapResults ?? []) {
      if (!result.completedAt) continue;
      const winnerIsTeam1 = result.winner === 'team1' || result.winnerTeam === 'team1';
      const winnerIsTeam2 = result.winner === 'team2' || result.winnerTeam === 'team2';
      if (!winnerIsTeam1 && !winnerIsTeam2) continue;
      const winnerName = winnerIsTeam1 ? t1 : t2;
      const loserName = winnerIsTeam1 ? t2 : t1;
      const winnerScore = winnerIsTeam1 ? result.team1Score : result.team2Score;
      const loserScore = winnerIsTeam1 ? result.team2Score : result.team1Score;
      events.push({
        id: `map-${match.slug}-${result.mapNumber}`,
        title: i18n.t('managePage.recent.mapResult', {
          winner: winnerName,
          map: result.mapNumber + 1,
          loser: loserName,
          score: `${winnerScore}–${loserScore}`,
        }),
        detail: result.mapName ?? '',
        timestamp: result.completedAt,
      });
    }

    if (match.completedAt && match.winner) {
      const winnerName = match.winner.name;
      const loserName = match.winner.id === match.team1?.id ? t2 : t1;
      events.push({
        id: `series-${match.slug}`,
        title: i18n.t('managePage.recent.seriesEnd', {
          winner: winnerName,
          loser: loserName,
          score: `${match.team1SeriesScore ?? match.team1Score ?? 0}–${match.team2SeriesScore ?? match.team2Score ?? 0}`,
        }),
        detail: '',
        timestamp: match.completedAt,
      });
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  return events.slice(0, limit);
}
