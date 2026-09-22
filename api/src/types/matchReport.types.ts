/**
 * Manual result reporting (3.0 phase D): the row types of `match_reports`,
 * `match_report_actions`, `custom_stat_fields` and `match_stat_values`.
 *
 * Schema only in D1 - no route, service or UI writes these yet. The types live
 * here so the tables have one description in TypeScript, and so the
 * manual-report module (D2 onwards) and its admin routes share it.
 *
 * Every account reference is a `players.uid`, never a Steam ID.
 */

/** Where a report is in its life. */
export type MatchReportStatus =
  /** Waiting for the opponent (or the timeout). */
  | 'submitted'
  /** Agreed, and turned into map_result / series_end events. */
  | 'confirmed'
  /** The opponent disagrees; the match waits for an admin (`needs_decision`). */
  | 'disputed'
  /** A newer report replaced it. */
  | 'superseded'
  /** The reporter took it back before anyone acted on it. */
  | 'withdrawn';

/** The two statuses that count as open: at most one per match (partial unique index). */
export const OPEN_MATCH_REPORT_STATUSES: readonly MatchReportStatus[] = ['submitted', 'disputed'];

/** Who produced the report: a team, or an admin overriding one. */
export type MatchReportSource = 'report' | 'admin';

/** What the tournament asks for before a report counts. */
export type MatchReportConfirmation = 'opponent' | 'none';

/** What happens when `confirm_deadline` passes with no answer. */
export type MatchReportTimeoutAction = 'auto_confirm' | 'escalate';

/** Every state change written to `match_report_actions`. */
export type MatchReportAction =
  | 'submit'
  | 'confirm'
  | 'dispute'
  | 'withdraw'
  | 'supersede'
  | 'resolve'
  | 'override'
  | 'reopen'
  | 'timeout_auto_confirm'
  | 'timeout_escalate';

/** Who took the action. */
export type MatchReportActorRole = 'captain' | 'admin' | 'system';

/** A reported map score. `mapName` is null for a game without maps. */
export interface ReportedMapResult {
  mapNumber: number;
  mapName?: string | null;
  team1Score: number;
  team2Score: number;
  /** 'team1' | 'team2' | null for a draw, when the tournament allows one. */
  winner?: 'team1' | 'team2' | null;
}

/**
 * The body of `match_reports.result`, stored as JSON. The series score is the
 * maps won; a best-of-1 has one map result and the same scores.
 */
export interface ReportedResult {
  maps: ReportedMapResult[];
  seriesTeam1Score: number;
  seriesTeam2Score: number;
  winner?: 'team1' | 'team2' | null;
  /** Free text the reporter added, e.g. a note about a forfeit. */
  note?: string | null;
}

export interface DbMatchReportRow {
  id: number;
  match_slug: string;
  revision: number;
  status: MatchReportStatus | string;
  source: MatchReportSource | string;
  submitted_by_uid: string | null;
  submitted_by_team: 'team1' | 'team2' | null | string;
  /** JSON, a `ReportedResult`. */
  result: string;
  confirmation: MatchReportConfirmation | string;
  confirm_deadline: number | null;
  timeout_action: MatchReportTimeoutAction | null | string;
  confirmed_by_uid: string | null;
  confirmed_at: number | null;
  disputed_by_uid: string | null;
  disputed_at: number | null;
  dispute_reason: string | null;
  resolved_by_uid: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DbMatchReportActionRow {
  id: number;
  report_id: number | null;
  match_slug: string;
  action: MatchReportAction | string;
  actor_uid: string | null;
  actor_role: MatchReportActorRole | string;
  /** JSON, or null. */
  detail: string | null;
  created_at: number;
}

/** A number the reporter types in, or a short text. */
export type CustomStatValueType = 'number' | 'text';

/** Whether a field is filled in per player or once per team. */
export type CustomStatScope = 'player' | 'team';

export interface DbCustomStatFieldRow {
  id: number;
  tournament_id: number;
  key: string;
  label: string;
  value_type: CustomStatValueType | string;
  scope: CustomStatScope | string;
  /** 1 = the reporter must fill it in. */
  required: number;
  display_order: number;
  created_at: number;
  updated_at: number;
}

export interface DbMatchStatValueRow {
  id: number;
  match_slug: string;
  /** 0 = the series total, 1.. = that map. */
  map_number: number;
  field_id: number;
  /** `players.uid`, or null for a team-scoped value. */
  player_uid: string | null;
  team: 'team1' | 'team2' | null | string;
  value_number: number | null;
  value_text: string | null;
  report_id: number | null;
  created_at: number;
  updated_at: number;
}
