/** A tournament as `GET /api/tournaments` lists it: the fields the navbar countdown needs. */
export interface ListedForStart {
  id: number;
  name: string;
  status: string;
  /** Unix seconds. */
  startsAt: number | null;
  mine: boolean;
  draft: boolean;
}

const WINDOW_MS = 24 * 3600_000;

/** The viewer's next tournament that has not started yet and starts within a day (`at` in ms). */
export function pickUpcoming(
  list: ListedForStart[],
  now: number
): { id: number; name: string; at: number } | null {
  const next = list
    .filter((t) => t.mine && !t.draft && t.status === 'setup' && t.startsAt)
    .map((t) => ({ id: t.id, name: t.name, at: (t.startsAt as number) * 1000 }))
    .filter((t) => t.at > now && t.at - now <= WINDOW_MS)
    .sort((a, b) => a.at - b.at)[0];
  return next ?? null;
}
