/**
 * Pure data-shaping helpers for the "Manage" console.
 *
 * Everything here derives from data the app already fetches for Matches,
 * Servers and Dashboard (GET /api/matches, GET /api/tournament/server-availability).
 * No new API calls are introduced by this module.
 */
import i18n from '../i18n';
import type { Match } from '../types/match.types';
import type { ServerAllocationInfo } from '../types/api.types';
import { getRoundLabel, getBracketMatchLabel } from './matchUtils';

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
  serverAvailability: { requiredServerCount: number } | null
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
    queued: serverAvailability?.requiredServerCount ?? 0,
    roundLabel,
  };
}

export type NeedsYouActionKind = 'decide' | 'reallocate' | 'forceCancel';

export interface NeedsYouAction {
  kind: NeedsYouActionKind;
  label: string;
  matchSlug: string;
}

export interface NeedsYouItem {
  id: string;
  /** Drives the coloured dot: 'ban' (red) for outages, 'warn' (accent) for decisions, 'info' for the rest. */
  severity: 'ban' | 'warn' | 'info';
  title: string;
  detail: string;
  actions: NeedsYouAction[];
  /** Present when one of the actions opens the match details/decision dialog. */
  decisionMatchSlug?: string;
}

function timeAgoLabel(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return i18n.t('managePage.needsYou.unknownTime');
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return i18n.t('managePage.needsYou.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t('managePage.needsYou.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return i18n.t('managePage.needsYou.hoursAgo', { count: hours });
}

function matchDisplayName(match: Match | undefined, slug: string): string {
  if (!match) return slug;
  const t1 = match.team1?.name ?? match.config?.team1?.name;
  const t2 = match.team2?.name ?? match.config?.team2?.name;
  if (t1 && t2) return i18n.t('managePage.needsYou.vsLabel', { team1: t1, team2: t2 });
  return slug;
}

/**
 * Build the "needs you" queue from real match/server state only:
 *  - matches stuck in `needs_decision` (out of maps, still level)
 *  - servers the allocator itself has flagged as stale (`staleMatchSlug`)
 *  - servers offline while still carrying an assigned match
 *
 * Each item's actions call the same endpoints AdminMatchControls uses
 * (`/winner`, `/reallocate`, `/force-cancel`), gated the same way that
 * component gates them (reallocate only for ready/loaded matches).
 */
export function computeNeedsYouItems(
  matches: Match[],
  serverAvailability: { servers: ServerAllocationInfo[] } | null
): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  const bySlug = new Map(matches.map((m) => [m.slug, m]));

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

  const servers = serverAvailability?.servers ?? [];
  for (const server of servers) {
    const slug = server.staleMatchSlug || (!server.online ? server.matchSlug : null);
    if (!slug) continue;

    const match = bySlug.get(slug);
    const canReallocate = !match || match.status === 'ready' || match.status === 'loaded';
    const matchLabel =
      (server.matchRound !== null &&
        getBracketMatchLabel({
          slug,
          bracket: server.matchBracket ?? null,
          round: server.matchRound ?? 0,
          matchNumber: server.matchNumber ?? 0,
        })) ||
      matchDisplayName(match, slug);

    const actions: NeedsYouAction[] = [];
    if (canReallocate) {
      actions.push({
        kind: 'reallocate',
        label: i18n.t('managePage.needsYou.reallocateAction'),
        matchSlug: slug,
      });
    }
    actions.push({
      kind: 'forceCancel',
      label: i18n.t('managePage.needsYou.forceCancelAction'),
      matchSlug: slug,
    });

    if (server.staleMatchSlug) {
      items.push({
        id: `stale-${server.id}`,
        severity: 'warn',
        title: i18n.t('managePage.needsYou.stale.title', { server: server.name }),
        detail: i18n.t('managePage.needsYou.stale.detail', { match: matchLabel }),
        actions,
      });
    } else {
      items.push({
        id: `offline-${server.id}`,
        severity: 'ban',
        title: i18n.t('managePage.needsYou.offline.title', { server: server.name }),
        detail: i18n.t('managePage.needsYou.offline.detail', {
          match: matchLabel,
          time: timeAgoLabel(server.updatedAt),
        }),
        actions,
      });
    }
  }

  return items;
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
