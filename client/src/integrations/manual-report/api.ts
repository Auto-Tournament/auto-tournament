/**
 * The manual-report module's HTTP surface, as the client sees it (3.0 phase D,
 * PR D7).
 *
 * The routes are PR D5's (`api/src/integrations/manual-report/*Routes.ts`),
 * mounted at `/api/game/manual` by the module itself — the core API knows
 * nothing about them, and neither does core client code.
 *
 * Everything goes through `request`, which hands back the status rather than
 * throwing on it. The panel has to tell three refusals apart:
 *
 *  - **401 / 403** — a spectator, or someone on neither team. The panel is not
 *    an error for them, it simply is not theirs, so it renders nothing.
 *  - **409 on the read** — a match another module owns (a CS2 match). Same.
 *  - **409 on a confirm** — the report moved while it was on screen. That one
 *    is worth saying out loud.
 */

export type ReportSide = 'team1' | 'team2';

export type ReportStatus = 'submitted' | 'confirmed' | 'disputed' | 'superseded' | 'withdrawn';

/** One game of the series, as a captain reported it. */
export interface ReportedGame {
  mapNumber: number;
  mapName?: string | null;
  team1Score: number;
  team2Score: number;
  winner?: ReportSide | null;
}

export interface ReportedResult {
  maps: ReportedGame[];
  seriesTeam1Score: number;
  seriesTeam2Score: number;
  winner?: ReportSide | null;
  note?: string | null;
}

export interface MatchReport {
  id: number;
  revision: number;
  status: ReportStatus;
  source: 'report' | 'admin';
  submittedByTeam: ReportSide | null;
  result: ReportedResult;
  /** Epoch **seconds**, not milliseconds, or null when nothing expires. */
  confirmDeadline: number | null;
  timeoutAction: 'auto_confirm' | 'escalate' | null;
  disputeReason: string | null;
  createdAt: number;
}

export interface ReportingRules {
  seriesLength: number;
  allowDraw: boolean;
  confirmation: 'opponent' | 'none';
  confirmTimeoutMin: number | null;
  timeoutAction: 'auto_confirm' | 'escalate';
}

/** What a value may hold (3.0 phase D, PR D6). */
export type StatValueType = 'number' | 'integer' | 'text';

/** Whether a field is asked of each player or of each side. */
export type StatScope = 'player' | 'team';

/** One extra number or word this tournament asks reporters for. */
export interface CustomStatField {
  id: number;
  key: string;
  label: string;
  valueType: StatValueType;
  scope: StatScope;
  required: boolean;
  displayOrder: number;
}

/** One recorded value, read back with its field and the person behind it. */
export interface MatchStatValue {
  fieldId: number;
  key: string;
  label: string;
  valueType: StatValueType;
  scope: StatScope;
  mapNumber: number;
  playerUid: string | null;
  playerId: string | null;
  playerName: string | null;
  team: ReportSide | null;
  value: number | string | null;
}

/** One value as the form posts it back. */
export interface ReportedStatValue {
  key: string;
  playerUid?: string;
  team?: ReportSide;
  value: number | string;
}

export interface TeamMember {
  accountUid: string;
  role: 'captain' | 'member';
  playerId: string | null;
  name: string | null;
}

/** Everything `GET /api/game/manual/matches/:slug` answers with. */
export interface MatchReportView {
  match: {
    slug: string;
    status: string;
    round?: number;
    bracket?: string | null;
    tournamentId: number;
    winnerId: string | null;
    /** `players` is the membership list a per-player field is filed against. */
    team1: { id: string | null; name: string | null; players?: TeamMember[] };
    team2: { id: string | null; name: string | null; players?: TeamMember[] };
  };
  rules: ReportingRules;
  /** The tournament's custom stat fields, in the order the form shows them. */
  fields?: CustomStatField[];
  /** What is filled in for them right now, confirmed or not. */
  stats?: MatchStatValue[];
  viewer: {
    team: ReportSide | null;
    role: 'captain' | 'admin' | 'system';
    canReport: boolean;
    canConfirm: boolean;
    canDispute: boolean;
    canWithdraw: boolean;
  };
  open: MatchReport | null;
  reports: MatchReport[];
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  error: string | null;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  } catch {
    // The network, not the API. Treated as a 0 so a caller can tell it from a
    // refusal and simply try again on the next socket event.
    return { status: 0, ok: false, data: null, error: 'network' };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const error =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null;

  return {
    status: response.status,
    ok: response.ok,
    data: response.ok ? (body as T) : null,
    error,
  };
}

export const manualReportApi = {
  /** The report page for one match. */
  view: (slug: string) => request<MatchReportView>(`/api/game/manual/matches/${slug}`),

  /**
   * Report a result, with the tournament's custom fields filled in.
   *
   * `stats` is a flat list whatever the tournament asks for, because the form
   * renders it from `fields` and posts it back the same shape. The API checks
   * it against those fields and refuses the **whole** report on one bad value,
   * which is why the panel checks the same rules before it sends.
   */
  report: (
    slug: string,
    result: { maps: Array<Omit<ReportedGame, 'mapNumber'>>; note?: string },
    stats?: ReportedStatValue[]
  ) =>
    request(`/api/game/manual/matches/${slug}/report`, {
      method: 'POST',
      body: JSON.stringify({ result, ...(stats && stats.length ? { stats } : {}) }),
    }),

  /**
   * Agree with the open report.
   *
   * `revision` is the one the panel has on screen. A number that is no longer
   * the open report's comes back 409, because a second report supersedes the
   * first and takes the next revision — without it, a captain confirms a
   * result they never read.
   */
  confirm: (slug: string, revision: number) =>
    request(`/api/game/manual/matches/${slug}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ revision }),
    }),

  dispute: (slug: string, revision: number, reason: string) =>
    request(`/api/game/manual/matches/${slug}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ revision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    }),

  withdraw: (slug: string, revision: number) =>
    request(`/api/game/manual/matches/${slug}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ revision }),
    }),

  members: (teamId: string) =>
    request<{ members: TeamMember[] }>(`/api/game/manual/teams/${teamId}/members`),

  setCaptain: (teamId: string, uid: string, role: 'captain' | 'member') =>
    request<{ members: TeamMember[] }>(`/api/game/manual/teams/${teamId}/captain`, {
      method: 'POST',
      body: JSON.stringify({ uid, role }),
    }),
};

/** A status that means "this panel is not for you", rather than a failure. */
export function isNotOurs(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 409;
}
