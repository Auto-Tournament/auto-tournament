/**
 * The integrator webhook events: their ids, what they carry, and the envelope.
 *
 * Event type ids are a public contract. They never change once shipped; a new
 * meaning is a new id. The payload is versioned by `api_version`: fields may be
 * added to it without a new version, never removed or renamed.
 *
 * Pure: no database, no Express. docs/WEBHOOKS.md documents the same list.
 */

/** Payload contract version, sent as `api_version` in every delivery. */
export const WEBHOOK_API_VERSION = '1';

export const WEBHOOK_EVENT_TYPES = [
  'match.ready',
  'match.live',
  'match.map_started',
  'match.score_updated',
  'match.map_ended',
  'match.finished',
  'match.cancelled',
  'match.reset',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookEventTypeInfo {
  type: WebhookEventType;
  /** When it fires, in one sentence (shown in the admin UI and the docs). */
  description: string;
  /** Whether `data.match.connect` is filled (when the match is connectable). */
  carriesConnect: boolean;
}

export const WEBHOOK_EVENT_CATALOG: ReadonlyArray<WebhookEventTypeInfo> = [
  {
    type: 'match.ready',
    description:
      'Players can connect: the match is loaded on a server. Sent again when the connect details change (the match moved to another server, or a restart).',
    carriesConnect: true,
  },
  {
    type: 'match.live',
    description: 'The match went live (the first map started being played).',
    carriesConnect: true,
  },
  {
    type: 'match.map_started',
    description: 'A map of the series became the current map while the match is live.',
    carriesConnect: true,
  },
  {
    type: 'match.score_updated',
    description:
      'The round score of the current map changed. Throttled: at most one per match every few seconds; the last score is always delivered.',
    carriesConnect: true,
  },
  {
    type: 'match.map_ended',
    description: 'A map finished; `data.map` holds its result.',
    carriesConnect: true,
  },
  {
    type: 'match.finished',
    description: 'The series is over and has a result.',
    carriesConnect: false,
  },
  {
    type: 'match.cancelled',
    description: 'The match was cancelled, ended by an admin without a result, or deleted.',
    carriesConnect: false,
  },
  {
    type: 'match.reset',
    description:
      'The match went back to an earlier state: restarted, unassigned from its server, or its result undone. A match.ready follows when it is loaded again.',
    carriesConnect: false,
  },
];

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export type TeamSide = 'team1' | 'team2';

export interface WebhookPlayer {
  steam_id64: string;
  name: string;
}

export interface WebhookTeam {
  /** Auto Tournament's team id; null for a standalone match side with no team row. */
  id: string | null;
  /**
   * The integrator's id for the team: the one pushed through the teams API
   * under this endpoint's source (see `external_ids` for all of them).
   */
  external_id: string | null;
  /** Every integrator id the team has, by source (the API token's label). */
  external_ids: Record<string, string>;
  name: string;
  tag: string | null;
  players: WebhookPlayer[];
}

export interface WebhookMapScore {
  /** 1-based position in the series. */
  number: number;
  name: string | null;
  team1: number;
  team2: number;
  status: 'upcoming' | 'live' | 'finished';
  winner: TeamSide | 'draw' | null;
}

export interface WebhookConnect {
  host: string;
  port: number;
  /** The server's join password (sv_password); null when it has none. */
  password: string | null;
  /** `steam://connect/host:port[/password]` — opens CS2 and joins. */
  steam_url: string;
  /** What to paste in the game console. */
  console: string;
}

export interface WebhookMatch {
  id: number;
  slug: string;
  /** pending | ready | loaded | live | completed | needs_decision | cancelled */
  status: string;
  game: string;
  round: number;
  match_number: number;
  bracket: string | null;
  best_of: number;
  tournament: { id: number; name: string } | null;
  team1: WebhookTeam | null;
  team2: WebhookTeam | null;
  score: {
    /** Maps won. */
    series: { team1: number; team2: number };
    /** The current map (the last one once the series is over); null before any map. */
    map: { number: number; name: string | null; team1: number; team2: number } | null;
  };
  maps: WebhookMapScore[];
  winner: { side: TeamSide; team_id: string | null } | null;
  /**
   * How players join. Only while the match is connectable (loaded or live)
   * and only in signed webhook deliveries: never on a public route, and
   * redacted in the delivery log.
   */
  connect: WebhookConnect | null;
}

export interface WebhookEventData {
  match: WebhookMatch;
  /** match.map_ended: the map that just finished. */
  map?: WebhookMapScore;
  /** The match status before this event, when it changed. */
  previous_status?: string | null;
  /** match.cancelled / match.reset: why. */
  reason?: string;
  /**
   * Per-match counter, raised by every event of that match. Deliveries can
   * arrive out of order (retries): ignore an event whose sequence is lower
   * than one you already applied for the match.
   */
  sequence: number;
}

export interface WebhookEnvelope {
  /** Event id: the same on every delivery attempt and every resend. Deduplicate on it. */
  id: string;
  type: WebhookEventType;
  /** ISO 8601, UTC. */
  created_at: string;
  api_version: string;
  /** true for events sent with "Send test event": made-up data, never a real match. */
  test: boolean;
  data: WebhookEventData;
}

/** `steam://connect/host:port/password` and the matching console line. */
export function connectLinks(host: string, port: number, password: string | null): Pick<WebhookConnect, 'steam_url' | 'console'> {
  const address = host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
  const pw = password && password.length > 0 ? password : null;
  return {
    steam_url: pw ? `steam://connect/${address}/${encodeURIComponent(pw)}` : `steam://connect/${address}`,
    console: pw ? `connect ${address}; password ${pw}` : `connect ${address}`,
  };
}
