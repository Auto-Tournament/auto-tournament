/**
 * One veto change at a time per match. A click reads the veto, changes it and
 * writes it back; two at once (a player clicking again while the first is slow,
 * or the turn timer acting as they click) both read the same step, both write,
 * and the last one wins. On the final step each of them also finished the veto
 * and loaded the match on a server.
 */
const tails = new Map<string, Promise<void>>();

export async function withVetoLock<T>(matchSlug: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(matchSlug) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  tails.set(matchSlug, tail);
  try {
    return await run;
  } finally {
    if (tails.get(matchSlug) === tail) tails.delete(matchSlug);
  }
}
