/**
 * Which webhook events a match change means.
 *
 * The platform does not announce events from the dozen code paths that change
 * a match (RCON events, fleet events, admin buttons, allocation, restarts).
 * It compares what it last announced for a match with what the match looks
 * like now, and derives the events from the difference. So every path is
 * covered, a burst of changes becomes one consistent set of events, and a
 * restart of the platform neither repeats nor loses one (the last announced
 * state is stored, services/webhooks/reconciler).
 *
 * Pure.
 */

import type { WebhookEventType } from './events';

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled']);
const CONNECTABLE: ReadonlySet<string> = new Set(['loaded', 'live']);
const DONE: ReadonlySet<string> = new Set(['completed', 'needs_decision', 'cancelled']);
const NOT_STARTED: ReadonlySet<string> = new Set(['pending', 'ready']);

/** What the diff looks at, now. */
export interface CurrentFacts {
  status: string;
  /** Hash of host, port and password; null when not joinable. */
  connectKey: string | null;
  mapNumber: number;
  mapScore: { team1: number; team2: number };
  /** 0-based map numbers with a stored result. */
  finishedMaps: number[];
}

/** What was last announced (stored per match). */
export interface AnnouncedState {
  status: string;
  connectKey: string | null;
  mapNumber: number;
  mapScore: { team1: number; team2: number };
  finishedMaps: number[];
  /** Epoch ms of the last match.score_updated. */
  lastScoreAt: number;
  /** Last `data.sequence` used for this match. */
  sequence: number;
}

export interface DerivedEvent {
  type: WebhookEventType;
  /** match.map_ended: which map (0-based). */
  mapNumber?: number;
  reason?: string;
  previousStatus?: string | null;
}

export interface DiffResult {
  events: DerivedEvent[];
  next: AnnouncedState;
  /** A throttled score is waiting: look again at this time (epoch ms). */
  recheckAt: number | null;
}

export const INITIAL_STATE: AnnouncedState = {
  status: 'pending',
  connectKey: null,
  mapNumber: -1,
  mapScore: { team1: 0, team2: 0 },
  finishedMaps: [],
  lastScoreAt: 0,
  sequence: 0,
};

export function diffMatch(
  prev: AnnouncedState | null,
  cur: CurrentFacts,
  opts: { now: number; scoreThrottleMs: number }
): DiffResult {
  // First sight of a match that is already over: nothing to announce.
  if (!prev && TERMINAL_STATUSES.has(cur.status)) {
    return {
      events: [],
      next: {
        ...INITIAL_STATE,
        status: cur.status,
        mapNumber: cur.mapNumber,
        mapScore: cur.mapScore,
        finishedMaps: [...cur.finishedMaps],
      },
      recheckAt: null,
    };
  }

  const p: AnnouncedState = prev ? { ...prev, finishedMaps: [...prev.finishedMaps] } : { ...INITIAL_STATE };
  const events: DerivedEvent[] = [];
  const statusChanged = p.status !== cur.status;
  const previousStatus = prev ? prev.status : null;

  // 1. Going backwards.
  let reset: string | null = null;
  if (NOT_STARTED.has(cur.status) && (CONNECTABLE.has(p.status) || DONE.has(p.status))) {
    reset = DONE.has(p.status) ? 'reopened' : 'unassigned';
  } else if (p.status === 'live' && cur.status === 'loaded') {
    reset = 'restarted';
  } else if (DONE.has(p.status) && CONNECTABLE.has(cur.status)) {
    reset = 'reopened';
  } else if (cur.finishedMaps.length < p.finishedMaps.length) {
    reset = 'results_cleared';
  }
  if (reset) {
    events.push({ type: 'match.reset', reason: reset, previousStatus });
    // Start over from here: what the match holds now is announced afresh.
    p.status = NOT_STARTED.has(cur.status) ? cur.status : 'pending';
    p.connectKey = null;
    p.mapNumber = -1;
    p.finishedMaps = cur.finishedMaps.filter((n) => p.finishedMaps.includes(n));
  }

  // 2. Cancelled.
  if (cur.status === 'cancelled' && p.status !== 'cancelled') {
    events.push({ type: 'match.cancelled', reason: 'cancelled', previousStatus });
  }

  // 3. Maps that finished since last time, in order.
  for (const n of [...cur.finishedMaps].sort((a, b) => a - b)) {
    if (!p.finishedMaps.includes(n)) events.push({ type: 'match.map_ended', mapNumber: n });
  }

  // 4. Joinable, or joinable somewhere else now.
  if (CONNECTABLE.has(cur.status) && cur.connectKey && cur.connectKey !== p.connectKey) {
    events.push({ type: 'match.ready', previousStatus: statusChanged ? previousStatus : undefined });
  }

  // 5. Live.
  const live = cur.status === 'live';
  if (live && p.status !== 'live') {
    events.push({ type: 'match.live', previousStatus });
  }

  // 6. A new map, and the score on it.
  let recheckAt: number | null = null;
  let mapScore = cur.mapScore;
  let lastScoreAt = p.lastScoreAt;
  const currentMapFinished = cur.finishedMaps.includes(cur.mapNumber);
  if (live && !currentMapFinished && (p.status !== 'live' || cur.mapNumber !== p.mapNumber)) {
    events.push({ type: 'match.map_started', mapNumber: cur.mapNumber });
  } else if (
    live &&
    !currentMapFinished &&
    cur.mapNumber === p.mapNumber &&
    (cur.mapScore.team1 !== p.mapScore.team1 || cur.mapScore.team2 !== p.mapScore.team2)
  ) {
    if (opts.now - p.lastScoreAt >= opts.scoreThrottleMs) {
      events.push({ type: 'match.score_updated' });
      lastScoreAt = opts.now;
    } else {
      // Keep the announced score, so the change is still a change next time.
      mapScore = p.mapScore;
      recheckAt = p.lastScoreAt + opts.scoreThrottleMs;
    }
  }

  // 7. Over.
  if (cur.status === 'completed' && p.status !== 'completed') {
    events.push({ type: 'match.finished', previousStatus });
  }

  return {
    events,
    next: {
      status: cur.status,
      connectKey: CONNECTABLE.has(cur.status) ? cur.connectKey : null,
      mapNumber: cur.mapNumber,
      mapScore,
      finishedMaps: [...cur.finishedMaps],
      lastScoreAt,
      sequence: p.sequence,
    },
    recheckAt,
  };
}
