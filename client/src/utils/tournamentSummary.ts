import type { TFunction } from 'i18next';
import type { TournamentSummary } from '../hooks/useTournamentList';
import { MATCH_FORMATS } from '../constants/tournament';
import { tournamentTabPath } from '../paths';

/**
 * How list views (Browse, Admin home, Home) describe one tournament: its
 * format line, when it is, and what a visitor can do next. Everything here is
 * read off the tournament row; nothing is guessed.
 */

/** "bo3" -> "Bo3"; the MATCH_FORMATS label when it is a known one. */
export function formatBadge(format: string): string {
  const known = MATCH_FORMATS.find((f) => f.value === format);
  if (known && format.length >= 2) return format[0].toUpperCase() + format.slice(1);
  return known?.label ?? format;
}

/** "8 teams · Single elimination · Bo1" */
export function formatLine(t: TFunction, tournament: TournamentSummary): string {
  return [
    t('browsePage.teamsCount', { count: tournament.teamCount }),
    t(`tournament.typeSelector.types.${tournament.type}.label`),
    formatBadge(tournament.format),
  ].join(' · ');
}

/** "Sat 5 Apr, 14:00" in the UI language. */
export function formatDayTime(epochMs: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(epochMs);
}

/** "5 Apr 2026" in the UI language. */
export function formatDay(epochMs: number, language: string): string {
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    epochMs
  );
}

export type TournamentWhen =
  | { kind: 'live' }
  | { kind: 'text'; text: string; muted: boolean };

/**
 * The "when" column: live now, when it starts (the first schedule row or the
 * start), or when it finished. "No date yet" rather than a made-up one.
 */
export function tournamentWhen(
  t: TFunction,
  tournament: TournamentSummary,
  language: string
): TournamentWhen {
  if (tournament.isLive) return { kind: 'live' };
  if (tournament.status === 'completed') {
    return {
      kind: 'text',
      muted: true,
      text: tournament.completedAt
        ? t('browsePage.when.finishedOn', { date: formatDay(tournament.completedAt, language) })
        : t('browsePage.when.finished'),
    };
  }
  if (tournament.startsAt) {
    return {
      kind: 'text',
      muted: false,
      text: t('browsePage.when.starts', { date: formatDayTime(tournament.startsAt, language) }),
    };
  }
  return { kind: 'text', muted: true, text: t('browsePage.when.noDate') };
}

export type TournamentAction = {
  /** `browsePage.actions.<key>` */
  key: 'watch' | 'results' | 'signUp';
  to: string;
  /** The one action worth the accent: signing up while it is open. */
  primary: boolean;
};

/**
 * What a visitor does next: sign up while it has not started (the event page
 * says how), watch it live, or read the results once it is over.
 */
export function tournamentAction(tournament: TournamentSummary): TournamentAction {
  if (tournament.isLive) {
    return { key: 'watch', to: tournamentTabPath(tournament.id), primary: false };
  }
  if (tournament.status === 'completed') {
    return { key: 'results', to: tournamentTabPath(tournament.id, 'standings'), primary: false };
  }
  return { key: 'signUp', to: tournamentTabPath(tournament.id), primary: true };
}
