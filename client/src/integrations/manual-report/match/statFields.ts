/**
 * The tournament's custom stat fields, as a form (3.0 phase D, PR D8).
 *
 * D6 gave a report somewhere to carry extra numbers and D7 deliberately left
 * them out of the form — "the report form is scores only" — because the API
 * side was still being written. This is the half that was missing: a captain
 * reporting a result fills the fields their tournament actually asks for, and
 * an admin ruling on a dispute fills the same ones, because
 * `POST .../resolve` is measured against exactly the same rules.
 *
 * **The checks here mirror `api/src/integrations/manual-report/statValues.ts`
 * on purpose, and are not a substitute for it.** The API refuses the *whole*
 * report on a single bad value, so a form that posts one typo loses the score
 * the captain typed too. Catching it on the page means the message names the
 * field while they are still looking at it, rather than coming back as one
 * line of prose above a form they have to fill in again.
 *
 * Two deliberate narrowings against what the API accepts:
 *
 * - **Series totals only.** A value may be filed against one game
 *   (`mapNumber` 1..n) as well as the series (0, the default). A per-game grid
 *   for five fields across ten players is a spreadsheet, not a form, so the
 *   form posts series totals and the API's per-game door stays open for
 *   whatever needs it. Mixing the two for one subject is refused by the API
 *   anyway, so a form that only ever sends one kind cannot produce that.
 * - **A player value carries no `team`.** The API reads the side off the
 *   membership and refuses a `team` that disagrees with it, so sending one
 *   could only ever be a way to be wrong.
 */

import type {
  CustomStatField,
  MatchReportView,
  ReportedStatValue,
  ReportSide,
  StatValueType,
} from '../api';

/** Whoever a value can be filed against: one player, or one whole side. */
export interface StatSubject {
  /** `players.uid` for a per-player field, the side for a per-team one. */
  id: string;
  label: string;
  side: ReportSide;
  playerUid: string | null;
}

/** What the form holds while it is being typed into: raw strings. */
export type StatDraft = Record<string, string>;

/** Numbers a scoreboard can hold, the same bound the API uses. */
const MAX_NUMBER = 1_000_000_000;

/** A short text field is a label, not an essay — `statValues.ts` MAX_TEXT. */
export const MAX_TEXT = 200;

/** One cell of the draft: this field, for this subject. */
export function cellKey(fieldKey: string, subjectId: string): string {
  return `${fieldKey}::${subjectId}`;
}

/** The sides this match actually has, in order. */
export function sidesOf(view: MatchReportView): ReportSide[] {
  return (['team1', 'team2'] as const).filter((side) => Boolean(view.match[side].id));
}

/**
 * Who a field is asked of, per side.
 *
 * A per-team field has exactly one subject per side. A per-player field has
 * one per membership — `team_members`, which is what a value is checked
 * against, so a roster entry that could never carry a number is never offered.
 */
export function subjectsFor(
  view: MatchReportView,
  field: CustomStatField,
  side: ReportSide,
  unknownName: string
): StatSubject[] {
  const team = view.match[side];
  if (!team.id) return [];
  if (field.scope === 'team') {
    return [{ id: side, label: team.name || unknownName, side, playerUid: null }];
  }
  return (team.players ?? []).map((member) => ({
    id: member.accountUid,
    label: member.name || member.playerId || unknownName,
    side,
    playerUid: member.accountUid,
  }));
}

/** Every subject of a field, both sides at once. */
export function allSubjects(
  view: MatchReportView,
  field: CustomStatField,
  unknownName: string
): StatSubject[] {
  return sidesOf(view).flatMap((side) => subjectsFor(view, field, side, unknownName));
}

export type DraftCheck =
  | { ok: true; values: ReportedStatValue[] }
  | { ok: false; error: string; cell: string | null };

/** How a single cell is wrong, or null when it is fine. */
type CellProblem = 'number' | 'integer' | 'range' | 'tooLong';

function checkCell(raw: string, valueType: StatValueType): CellProblem | null {
  if (valueType === 'text') return raw.length > MAX_TEXT ? 'tooLong' : null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'number';
  if (Math.abs(n) > MAX_NUMBER) return 'range';
  if (valueType === 'integer' && !Number.isInteger(n)) return 'integer';
  return null;
}

/**
 * Turn what has been typed into what the API takes, or say what is wrong.
 *
 * Blank is "not filled in" and is dropped, exactly as the API drops it — which
 * is also what makes `required` mean something: a required field has to have
 * been filled in **for each side**, not for every player, because a captain
 * inventing a number for somebody who never turned up is worse than a missing
 * row. That is the API's rule (`requiredCheck`), repeated here so the form can
 * point at the side that is empty.
 */
export function validateDraft(
  view: MatchReportView,
  fields: CustomStatField[],
  draft: StatDraft,
  labels: {
    unknownTeam: string;
    problem: (problem: CellProblem, field: CustomStatField, subject: StatSubject) => string;
    missing: (field: CustomStatField, teamName: string) => string;
  }
): DraftCheck {
  const values: ReportedStatValue[] = [];
  const sides = sidesOf(view);

  for (const field of fields) {
    const filledBySide = new Map<ReportSide, number>(sides.map((side) => [side, 0]));

    for (const subject of allSubjects(view, field, labels.unknownTeam)) {
      const cell = cellKey(field.key, subject.id);
      const raw = (draft[cell] ?? '').trim();
      if (!raw) continue;

      const problem = checkCell(raw, field.valueType);
      if (problem) {
        return { ok: false, error: labels.problem(problem, field, subject), cell };
      }

      filledBySide.set(subject.side, (filledBySide.get(subject.side) ?? 0) + 1);
      values.push({
        key: field.key,
        ...(subject.playerUid
          ? // The API reads the side off the membership; sending one that
            // disagrees is a 400 and sending one that agrees is noise.
            { playerUid: subject.playerUid }
          : { team: subject.side }),
        value: field.valueType === 'text' ? raw : Number(raw),
      });
    }

    if (!field.required) continue;
    for (const side of sides) {
      if ((filledBySide.get(side) ?? 0) > 0) continue;
      return {
        ok: false,
        error: labels.missing(field, view.match[side].name || labels.unknownTeam),
        cell: null,
      };
    }
  }

  return { ok: true, values };
}

/** Whether a tournament asks for anything beyond the score. */
export function hasFields(view: MatchReportView | null): boolean {
  return (view?.fields?.length ?? 0) > 0;
}

/** The values already recorded, keyed the way the draft is, for prefilling. */
export function draftFromRecorded(view: MatchReportView): StatDraft {
  const draft: StatDraft = {};
  for (const value of view.stats ?? []) {
    // Per-game values exist in the API and never come out of this form; they
    // would collide with the series cell, so they are left where they are.
    if (value.mapNumber !== 0 || value.value === null) continue;
    const subjectId = value.playerUid ?? value.team;
    if (!subjectId) continue;
    draft[cellKey(value.key, subjectId)] = String(value.value);
  }
  return draft;
}
