/**
 * The values a reporter types into a tournament's custom fields (3.0 phase D,
 * PR D6).
 *
 * D5 gave a tournament a list of fields (`./fields`, `custom_stat_fields`).
 * This is the other half: the numbers and short texts that arrive with a
 * report, checked against those fields, written to `match_stat_values`, and
 * read back — per match, and summed over a tournament.
 *
 * **Ratings do not see any of this.** Rating maths runs on the CS2 metrics
 * path; a custom field is display only. Nothing here touches
 * `player_match_stats`, `player_ratings` or `matchLifecycle`, and a tournament
 * with fifty fields rates exactly like one with none.
 *
 * The rules a set of values is measured by:
 *
 * - **Unknown keys are refused**, not dropped. A form that posts `assits`
 *   should hear about it while the captain is still looking at the page.
 * - **A player value is keyed on `players.uid`**, and that account has to be
 *   on one of the two teams (`team_members`, D1). The side is then read off
 *   the membership rather than taken from the request, so a value cannot be
 *   filed against the opponent.
 * - **A team value names a side** (`team1`/`team2`) and carries no player.
 * - **An empty value is "not filled in"**, not zero: it is dropped, and a
 *   `required` field then fails the check.
 * - **`required` means neither side may be blank** — at least one value for
 *   that field on each team that is in the match. Not "every player on the
 *   roster", because the reporter would have to invent numbers for players who
 *   never turned up.
 * - **Series total or per game, never both.** A value is filed against the
 *   series (`mapNumber: 0`, the default) or against one game (1..n). Mixing
 *   them for the same field and the same subject is refused, because then no
 *   sum over a tournament could be right.
 *
 * The values that stand are the ones from the report that stands: a new report
 * replaces the whole set for the match (`replaceValues`), and a withdrawn
 * report or a reopened match clears it (`clearValues`). `match_stat_values`
 * therefore always describes the open or confirmed report, never a mixture of
 * revisions.
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { teamMembers } from '../../services/teamMembers';
import type {
  CustomStatScope,
  CustomStatValueType,
  DbMatchStatValueRow,
} from '../../types/matchReport.types';
import type { TeamSide } from '../types';
import type { CustomStatField } from './fields';

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** One value as a reporter sends it. */
export interface ReportedStatValue {
  /** The `custom_stat_fields.key` this is for. */
  key: string;
  /** 0 (or absent) = the whole series, 1.. = that game. */
  mapNumber?: number;
  /** `players.uid`, for a `player` field. */
  playerUid?: string | null;
  /** The side, for a `team` field. Ignored for a player value. */
  team?: TeamSide | null;
  value?: unknown;
}

/** A checked value, ready to be written. */
export interface StatValueWrite {
  fieldId: number;
  key: string;
  mapNumber: number;
  playerUid: string | null;
  team: TeamSide;
  valueNumber: number | null;
  valueText: string | null;
}

/** A value as it is read back: the row, with the field and the person on it. */
export interface MatchStatValue {
  fieldId: number;
  key: string;
  label: string;
  valueType: CustomStatValueType;
  scope: CustomStatScope;
  mapNumber: number;
  playerUid: string | null;
  /** `players.id` — still a Steam id in 3.0; null when the account has gone. */
  playerId: string | null;
  playerName: string | null;
  team: TeamSide | null;
  value: number | string | null;
  reportId: number | null;
}

export type StatValuesCheck =
  | { ok: true; values: StatValueWrite[] }
  | { ok: false; error: string };

/** What the values are checked against. */
export interface StatValuesContext {
  fields: CustomStatField[];
  /** How many games the report carries; a `mapNumber` above this is refused. */
  gameCount: number;
  /** Which side each account is on, for the two teams of this match. */
  sideOf: Map<string, TeamSide>;
  /** The sides that exist in this match; a `required` field is wanted on each. */
  sides: TeamSide[];
}

/** One report cannot carry more than this; a form that does is a bug or an attack. */
const MAX_VALUES = 500;

/** A short text field is a label, not an essay. */
const MAX_TEXT = 200;

/** Numbers a scoreboard can hold. Outside this is a typo or a probe. */
const MAX_NUMBER = 1_000_000_000;

const SIDES: readonly string[] = ['team1', 'team2'];

// ---------------------------------------------------------------------------
// Who is on which side
// ---------------------------------------------------------------------------

/**
 * The account -> side map for a match's two teams, from `team_members`.
 *
 * Membership is the roster mirrored by `teamMembers.syncFromRoster`, so this
 * is the same set of people `teams.players` holds, keyed on `players.uid`. An
 * account on both teams (which the schema allows and a real instance should
 * not have) counts as `team1`, the side its match row names first.
 */
export async function sidesForMatch(match: {
  team1_id?: string | null;
  team2_id?: string | null;
}): Promise<{ sideOf: Map<string, TeamSide>; sides: TeamSide[] }> {
  const sideOf = new Map<string, TeamSide>();
  const sides: TeamSide[] = [];
  for (const [side, teamId] of [
    ['team2', match.team2_id],
    ['team1', match.team1_id],
  ] as const) {
    if (!teamId) continue;
    sides.unshift(side);
    for (const member of await teamMembers.list(teamId)) {
      sideOf.set(member.accountUid, side);
    }
  }
  return { sideOf, sides };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/** `number` and `integer` land in `value_number`, `text` in `value_text`. */
function readValue(
  raw: unknown,
  valueType: CustomStatValueType,
  where: string
): { ok: true; number: number | null; text: string | null } | { ok: false; error: string } | null {
  // Absent is "not filled in", which is only a problem for a required field —
  // and that is checked once, over the whole set, rather than here.
  if (raw === undefined || raw === null) return null;

  if (valueType === 'text') {
    if (typeof raw !== 'string') return { ok: false, error: `${where}: must be text` };
    const text = raw.trim();
    if (!text) return null;
    if (text.length > MAX_TEXT) {
      return { ok: false, error: `${where}: longer than ${MAX_TEXT} characters` };
    }
    return { ok: true, number: null, text };
  }

  if (typeof raw === 'string' && !raw.trim()) return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { ok: false, error: `${where}: must be a number` };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${where}: must be a number` };
  if (Math.abs(n) > MAX_NUMBER) {
    return { ok: false, error: `${where}: must be between -${MAX_NUMBER} and ${MAX_NUMBER}` };
  }
  if (valueType === 'integer' && !Number.isInteger(n)) {
    return { ok: false, error: `${where}: must be a whole number` };
  }
  return { ok: true, number: n, text: null };
}

/**
 * Check every value in a report against the tournament's fields.
 *
 * All or nothing: a set with one bad value writes none of it, so a report
 * either carries the numbers it says it does or it is refused outright.
 */
export function validateStatValues(input: unknown, ctx: StatValuesContext): StatValuesCheck {
  if (input === undefined || input === null) {
    return requiredCheck([], ctx);
  }
  if (!Array.isArray(input)) return { ok: false, error: 'stats must be an array' };
  if (input.length > MAX_VALUES) {
    return { ok: false, error: `A report may carry at most ${MAX_VALUES} stat values` };
  }
  if (input.length > 0 && ctx.fields.length === 0) {
    return { ok: false, error: 'This tournament asks for no extra stats' };
  }

  const byKey = new Map(ctx.fields.map((field) => [field.key, field]));
  const values: StatValueWrite[] = [];
  /** field+subject -> the map numbers seen, so series and per-game cannot mix. */
  const mapsSeen = new Map<string, Set<number>>();
  const seen = new Set<string>();

  for (const [index, raw] of input.entries()) {
    const entry = (raw ?? {}) as ReportedStatValue;
    const key = typeof entry.key === 'string' ? entry.key.trim().toLowerCase() : '';
    const field = byKey.get(key);
    if (!field) {
      return {
        ok: false,
        error: `Stat ${index + 1}: this tournament does not ask for '${key || '(no key)'}'`,
      };
    }
    const where = `Stat ${index + 1} ('${field.label}')`;

    const mapNumber = entry.mapNumber === undefined || entry.mapNumber === null ? 0 : Number(entry.mapNumber);
    if (!Number.isInteger(mapNumber) || mapNumber < 0 || mapNumber > ctx.gameCount) {
      return {
        ok: false,
        error: `${where}: mapNumber must be 0 (the series) or a game between 1 and ${ctx.gameCount}`,
      };
    }

    let playerUid: string | null = null;
    let side: TeamSide;

    if (field.scope === 'player') {
      const uid = typeof entry.playerUid === 'string' ? entry.playerUid.trim() : '';
      if (!uid) return { ok: false, error: `${where}: playerUid is required, it is a per-player field` };
      const memberSide = ctx.sideOf.get(uid);
      if (!memberSide) {
        return { ok: false, error: `${where}: ${uid} is not on either team in this match` };
      }
      if (
        typeof entry.team === 'string' &&
        SIDES.includes(entry.team) &&
        entry.team !== memberSide
      ) {
        return { ok: false, error: `${where}: ${uid} plays for ${memberSide}, not ${entry.team}` };
      }
      playerUid = uid;
      side = memberSide;
    } else {
      if (entry.playerUid) {
        return { ok: false, error: `${where}: it is a per-team field, so it takes no playerUid` };
      }
      const team = typeof entry.team === 'string' ? entry.team.trim() : '';
      if (!SIDES.includes(team)) {
        return { ok: false, error: `${where}: team must be 'team1' or 'team2'` };
      }
      if (!ctx.sides.includes(team as TeamSide)) {
        return { ok: false, error: `${where}: this match has no ${team}` };
      }
      side = team as TeamSide;
    }

    const read = readValue(entry.value, field.valueType, where);
    // Left blank: dropped, and caught below if the field is required.
    if (read === null) continue;
    if (!read.ok) return read;

    const subject = `${field.key}|${playerUid ?? side}`;
    const duplicate = `${subject}|${mapNumber}`;
    if (seen.has(duplicate)) {
      return { ok: false, error: `${where}: given twice for the same ${playerUid ? 'player' : 'team'}` };
    }
    seen.add(duplicate);

    const maps = mapsSeen.get(subject) ?? new Set<number>();
    maps.add(mapNumber);
    mapsSeen.set(subject, maps);
    if (maps.size > 1 && maps.has(0)) {
      return {
        ok: false,
        error: `${where}: give either a series total or a value per game, not both`,
      };
    }

    values.push({
      fieldId: field.id,
      key: field.key,
      mapNumber,
      playerUid,
      team: side,
      valueNumber: read.number,
      valueText: read.text,
    });
  }

  return requiredCheck(values, ctx);
}

/**
 * Every required field must have been filled in for both sides.
 *
 * Per side, not per player: a captain reporting a 5v5 knows their own numbers
 * and the opponent's score, and inventing a value for someone who never played
 * is worse than leaving the row out.
 */
function requiredCheck(values: StatValueWrite[], ctx: StatValuesContext): StatValuesCheck {
  for (const field of ctx.fields) {
    if (!field.required) continue;
    for (const side of ctx.sides) {
      const filled = values.some((v) => v.fieldId === field.id && v.team === side);
      if (!filled) {
        return {
          ok: false,
          error: `'${field.label}' is required, and nothing was reported for ${side}`,
        };
      }
    }
  }
  return { ok: true, values };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Make the match's values exactly this set, filed against this report.
 *
 * The whole set is replaced rather than merged: a report supersedes the one
 * before it, so its numbers replace that report's numbers too. Without this
 * the unique indexes (one value per field per player per game) would refuse
 * the second report's rows and leave the first report's numbers standing next
 * to the second report's score.
 */
export async function replaceValues(
  matchSlug: string,
  reportId: number | null,
  values: StatValueWrite[]
): Promise<void> {
  await db.runAsync('DELETE FROM match_stat_values WHERE match_slug = ?', [matchSlug]);
  for (const value of values) {
    await db.insertAsync('match_stat_values', {
      match_slug: matchSlug,
      map_number: value.mapNumber,
      field_id: value.fieldId,
      player_uid: value.playerUid,
      team: value.team,
      value_number: value.valueNumber,
      value_text: value.valueText,
      report_id: reportId,
    });
  }
}

/** Nothing stands for this match any more: a withdrawn report, or a reopen. */
export async function clearValues(matchSlug: string): Promise<void> {
  try {
    await db.runAsync('DELETE FROM match_stat_values WHERE match_slug = ?', [matchSlug]);
  } catch (err) {
    // Clearing values must not be the reason a withdrawal or a reopen fails.
    log.warn(`[manual-report] Could not clear the stat values of ${matchSlug}`, {
      error: (err as Error).message,
    });
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface JoinedValueRow extends DbMatchStatValueRow {
  key: string;
  label: string;
  value_type: string;
  scope: string;
  player_id: string | null;
  player_name: string | null;
}

function toValue(row: JoinedValueRow): MatchStatValue {
  const valueType: CustomStatValueType =
    row.value_type === 'text' ? 'text' : row.value_type === 'integer' ? 'integer' : 'number';
  return {
    fieldId: Number(row.field_id),
    key: row.key,
    label: row.label,
    valueType,
    scope: row.scope === 'team' ? 'team' : 'player',
    mapNumber: Number(row.map_number),
    playerUid: row.player_uid,
    playerId: row.player_id,
    playerName: row.player_name,
    team: (row.team as TeamSide | null) ?? null,
    value: valueType === 'text' ? row.value_text : row.value_number === null ? null : Number(row.value_number),
    reportId: row.report_id === null ? null : Number(row.report_id),
  };
}

/**
 * The custom values recorded for one match, in the order the fields are shown.
 *
 * This is what a match page reads back, so it is whatever stands right now —
 * including the values of a report nobody has confirmed yet. The people who
 * can see it are the two captains and an admin (the match route is guarded);
 * the tournament listing below is the public, settled view.
 */
export async function listValues(matchSlug: string): Promise<MatchStatValue[]> {
  const rows = await db.queryAsync<JoinedValueRow>(
    `SELECT v.*, f.key, f.label, f.value_type, f.scope,
            p.id AS player_id, p.name AS player_name
       FROM match_stat_values v
       JOIN custom_stat_fields f ON f.id = v.field_id
       LEFT JOIN players p ON p.uid = v.player_uid
      WHERE v.match_slug = ?
      ORDER BY f.display_order, f.id, v.map_number, v.team, p.name NULLS FIRST, v.id`,
    [matchSlug]
  );
  return rows.map(toValue);
}

// ---------------------------------------------------------------------------
// A tournament's stats
// ---------------------------------------------------------------------------

/** What one field adds up to for one player or one team. */
export interface StatTotal {
  key: string;
  label: string;
  valueType: CustomStatValueType;
  /** Null for a text field: there is nothing to add up. */
  total: number | null;
  average: number | null;
  /** How many values were recorded. */
  count: number;
  /** The most recent text values, for a text field. */
  texts?: string[];
}

export interface StatSubject {
  /** Matches this subject recorded a value in. */
  matches: number;
  totals: StatTotal[];
}

export interface PlayerStatLine extends StatSubject {
  uid: string;
  /** `players.id` — still a Steam id in 3.0. */
  playerId: string | null;
  name: string | null;
  /** The teams they recorded values for, in this tournament. */
  teams: Array<{ id: string; name: string | null }>;
}

export interface TeamStatLine extends StatSubject {
  id: string;
  name: string | null;
}

export interface TournamentStats {
  fields: CustomStatField[];
  players: PlayerStatLine[];
  teams: TeamStatLine[];
}

interface TournamentValueRow extends JoinedValueRow {
  display_order: number;
  match_team1_id: string | null;
  match_team2_id: string | null;
}

/** An accumulator per subject, before it is turned into a line. */
interface Bucket {
  matches: Set<string>;
  byField: Map<number, { field: CustomStatField; total: number; count: number; texts: string[] }>;
}

function bucket(map: Map<string, Bucket>, id: string): Bucket {
  const found = map.get(id);
  if (found) return found;
  const made: Bucket = { matches: new Set(), byField: new Map() };
  map.set(id, made);
  return made;
}

function addTo(bucketFor: Bucket, field: CustomStatField, row: TournamentValueRow): void {
  bucketFor.matches.add(row.match_slug);
  const entry = bucketFor.byField.get(field.id) ?? { field, total: 0, count: 0, texts: [] };
  if (field.valueType === 'text') {
    if (row.value_text !== null) {
      entry.count += 1;
      if (entry.texts.length < 20) entry.texts.push(row.value_text);
    }
  } else if (row.value_number !== null) {
    entry.total += Number(row.value_number);
    entry.count += 1;
  }
  bucketFor.byField.set(field.id, entry);
}

function totalsOf(bucketFor: Bucket, fields: CustomStatField[]): StatTotal[] {
  const totals: StatTotal[] = [];
  for (const field of fields) {
    const entry = bucketFor.byField.get(field.id);
    if (!entry || entry.count === 0) continue;
    totals.push({
      key: field.key,
      label: field.label,
      valueType: field.valueType,
      total: field.valueType === 'text' ? null : round(entry.total),
      average: field.valueType === 'text' ? null : round(entry.total / entry.count),
      count: entry.count,
      ...(field.valueType === 'text' ? { texts: entry.texts } : {}),
    });
  }
  return totals;
}

/** Keep a sum of REALs from reading as 4.300000000000001. */
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Every custom value recorded in a tournament, added up per player and per
 * team.
 *
 * **Only confirmed reports count.** A number one captain typed in ten minutes
 * ago, that the other has not agreed to and may yet dispute, is not a
 * tournament statistic. It is on the match page for the two of them and an
 * admin to look at, and it arrives here when the report is settled — by the
 * opponent, by the deadline or by an admin.
 *
 * A field a tournament later dropped takes its values with it
 * (`match_stat_values.field_id` cascades), so a listing never shows a column
 * nobody can explain.
 */
export async function tournamentStats(
  tournamentId: number,
  fields: CustomStatField[]
): Promise<TournamentStats> {
  if (fields.length === 0) return { fields, players: [], teams: [] };

  const rows = await db.queryAsync<TournamentValueRow>(
    `SELECT v.*, f.key, f.label, f.value_type, f.scope, f.display_order,
            m.team1_id AS match_team1_id, m.team2_id AS match_team2_id,
            p.id AS player_id, p.name AS player_name
       FROM match_stat_values v
       JOIN custom_stat_fields f ON f.id = v.field_id
       JOIN matches m ON m.slug = v.match_slug
       JOIN match_reports r ON r.id = v.report_id
       LEFT JOIN players p ON p.uid = v.player_uid
      WHERE f.tournament_id = ?
        AND m.tournament_id = ?
        AND r.status = 'confirmed'
      ORDER BY f.display_order, f.id, v.id`,
    [tournamentId, tournamentId]
  );

  const byId = new Map(fields.map((field) => [field.id, field]));
  const playerBuckets = new Map<string, Bucket>();
  const teamBuckets = new Map<string, Bucket>();
  const playerMeta = new Map<string, { playerId: string | null; name: string | null; teams: Set<string> }>();
  const teamIds = new Set<string>();

  for (const row of rows) {
    const field = byId.get(Number(row.field_id));
    if (!field) continue;
    const teamId = row.team === 'team2' ? row.match_team2_id : row.match_team1_id;

    if (row.player_uid) {
      addTo(bucket(playerBuckets, row.player_uid), field, row);
      const meta = playerMeta.get(row.player_uid) ?? {
        playerId: row.player_id,
        name: row.player_name,
        teams: new Set<string>(),
      };
      if (teamId) {
        meta.teams.add(teamId);
        teamIds.add(teamId);
      }
      playerMeta.set(row.player_uid, meta);
    } else if (teamId) {
      addTo(bucket(teamBuckets, teamId), field, row);
      teamIds.add(teamId);
    }
  }

  const names = await teamNamesFor([...teamIds]);

  const players: PlayerStatLine[] = [...playerBuckets.entries()]
    .map(([uid, made]) => {
      const meta = playerMeta.get(uid);
      return {
        uid,
        playerId: meta?.playerId ?? null,
        name: meta?.name ?? null,
        teams: [...(meta?.teams ?? [])].map((id) => ({ id, name: names.get(id) ?? null })),
        matches: made.matches.size,
        totals: totalsOf(made, fields),
      };
    })
    .sort((a, b) => (a.name ?? a.uid).localeCompare(b.name ?? b.uid));

  const teams: TeamStatLine[] = [...teamBuckets.entries()]
    .map(([id, made]) => ({
      id,
      name: names.get(id) ?? null,
      matches: made.matches.size,
      totals: totalsOf(made, fields),
    }))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

  return { fields, players, teams };
}

async function teamNamesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.queryAsync<{ id: string; name: string }>(
    'SELECT id, name FROM teams WHERE id = ANY(?::text[])',
    [ids]
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}
