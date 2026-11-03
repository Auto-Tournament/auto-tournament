/**
 * When the site's other tournaments play (GET /api/tournaments/play-windows),
 * for the setup's overlap warnings (Claude Design, Name and day and Schedule).
 * They only warn: the admin can always save.
 */
import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { dayOf } from '../utils/localDay';

export interface OtherTournament {
  id: number;
  name: string;
  windows: Array<{ start: string; end: string; round: number | null }>;
}

export function usePlayWindows(excludeId: number | null | undefined): OtherTournament[] {
  const [others, setOthers] = useState<OtherTournament[]>([]);
  useEffect(() => {
    let live = true;
    const query = excludeId ? `?exclude=${excludeId}` : '';
    api
      .get<{ tournaments?: OtherTournament[] }>(`/api/tournaments/play-windows${query}`)
      .then((r) => live && setOthers(r.tournaments ?? []))
      .catch(() => live && setOthers([]));
    return () => {
      live = false;
    };
  }, [excludeId]);
  return others;
}

/** The local days the others play ("YYYY-MM-DD"). */
export function playDaysOf(others: OtherTournament[]): string[] {
  const days = new Set<string>();
  for (const o of others) for (const w of o.windows) days.add(dayOf(new Date(w.start)));
  return [...days];
}

/** The first other tournament playing on one of `days`, with its window that day. */
export function onDays(
  others: OtherTournament[],
  days: string[]
): { name: string; id: number; day: string; start: Date; end: Date } | null {
  for (const o of others) {
    const onDay = o.windows.filter((w) => days.includes(dayOf(new Date(w.start))));
    if (onDay.length) {
      const day = dayOf(new Date(onDay[0].start));
      const same = onDay.filter((w) => dayOf(new Date(w.start)) === day);
      return {
        name: o.name,
        id: o.id,
        day,
        start: new Date(Math.min(...same.map((w) => Date.parse(w.start)))),
        end: new Date(Math.max(...same.map((w) => Date.parse(w.end)))),
      };
    }
  }
  return null;
}

/** The first other tournament whose window overlaps [start, end), with that window. */
export function overlapping(
  others: OtherTournament[],
  start: number,
  end: number
): { name: string; id: number; start: Date; end: Date } | null {
  for (const o of others) {
    const w = o.windows.find((x) => Date.parse(x.start) < end && start < Date.parse(x.end));
    if (w) return { name: o.name, id: o.id, start: new Date(w.start), end: new Date(w.end) };
  }
  return null;
}
