/**
 * What core shows of CS2's queue itself, read out of this module's own
 * availability answer (client API 0.2.0).
 *
 * Core used to read `requiredServerCount` and `servers` off that answer
 * directly, in the match list, the Manage console and the admin home. It now
 * reads only `nextAllocationInSeconds`, and asks these for the rest.
 */

import { api, getBracketMatchLabel } from '../../../module-sdk';
import type {
  AdminHomeSetupItem,
  ManageNeedsYouAction,
  ManageNeedsYouInput,
  ManageNeedsYouItem,
  ResourceAvailability,
  ResourceQueueSummary,
} from '../../types';
import { asServerAvailability, type ServersResponse } from '../cs2.types';

/** Matches waiting for a server, and how many servers there are. */
export function summarizeServerAvailability(availability: ResourceAvailability): ResourceQueueSummary {
  const answer = asServerAvailability(availability);
  return {
    waitingMatches: answer?.requiredServerCount ?? 0,
    resourceCount: answer?.servers?.length ?? 0,
  };
}

function timeAgoLabel(t: ManageNeedsYouInput['t'], unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return t('managePage.needsYou.unknownTime');
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return t('managePage.needsYou.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('managePage.needsYou.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t('managePage.needsYou.hoursAgo', { count: hours });
}

/**
 * The Manage console's rows about servers: one flagged stale by the
 * allocator, or offline while it still holds a match. Reallocating is offered
 * only for a match that is ready or loaded (or no longer listed), as
 * AdminMatchControls gates it.
 */
export function serverNeedsYouItems({ availability, matches, t }: ManageNeedsYouInput): ManageNeedsYouItem[] {
  const servers = asServerAvailability(availability)?.servers ?? [];
  const bySlug = new Map(matches.map((match) => [match.slug, match]));
  const items: ManageNeedsYouItem[] = [];

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
      match?.name ||
      slug;

    const actions: ManageNeedsYouAction[] = [];
    if (canReallocate) {
      actions.push({
        kind: 'reallocate',
        label: t('managePage.needsYou.reallocateAction'),
        matchSlug: slug,
      });
    }
    actions.push({
      kind: 'forceCancel',
      label: t('managePage.needsYou.forceCancelAction'),
      matchSlug: slug,
    });

    if (server.staleMatchSlug) {
      items.push({
        id: `stale-${server.id}`,
        severity: 'warn',
        title: t('managePage.needsYou.stale.title', { server: server.name }),
        detail: t('managePage.needsYou.stale.detail', { match: matchLabel }),
        actions,
      });
    } else {
      items.push({
        id: `offline-${server.id}`,
        severity: 'ban',
        title: t('managePage.needsYou.offline.title', { server: server.name }),
        detail: t('managePage.needsYou.offline.detail', {
          match: matchLabel,
          time: timeAgoLabel(t, server.updatedAt),
        }),
        actions,
      });
    }
  }

  return items;
}

/** The admin home's "Add a server" row, from this module's own server list. */
export async function serversSetupItems(): Promise<AdminHomeSetupItem[]> {
  let count = 0;
  try {
    const response = await api.get<ServersResponse>('/api/servers');
    count = (response.servers ?? []).length;
  } catch {
    count = 0;
  }
  return [
    {
      key: 'servers',
      done: count > 0,
      labelKey:
        count > 0
          ? count === 1
            ? 'dashboard.setup.serversDone'
            : 'dashboard.setup.serversDonePlural'
          : 'dashboard.setup.serversTodo',
      labelValues: { count },
    },
  ];
}
