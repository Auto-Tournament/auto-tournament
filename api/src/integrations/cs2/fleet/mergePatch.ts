/**
 * RFC 7386 JSON merge patch, and a structural diff for the snapshot drift
 * check. Pure: no I/O, inputs are never mutated.
 *
 * Ready Up sends MatchState changes as merge patches (`state.patch` and every
 * `event.*`, docs/fleet-step3-platform-notes.md §3): an object member is
 * merged recursively, `null` removes a member, and anything else (arrays,
 * scalars) replaces the target's value whole.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `target` with `patch` applied (RFC 7386 §2). */
export function applyMergePatch<T = unknown>(target: unknown, patch: unknown): T {
  if (!isObject(patch)) return clone(patch) as T;
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else {
      out[key] = applyMergePatch(out[key], value);
    }
  }
  return out as T;
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

/** Deep equality for JSON values (member order does not matter). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

/**
 * The paths where `a` and `b` differ (`teams.team1.score`, `pause.type`),
 * at most `limit` of them, in a stable order. For logging a drift between the
 * stored state and a snapshot.
 */
export function diffPaths(a: unknown, b: unknown, limit = 20, prefix = ''): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (out.length >= limit) return;
    if (isObject(x) && isObject(y)) {
      const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
      for (const k of keys) walk(x[k], y[k], path ? `${path}.${k}` : k);
      return;
    }
    if (!jsonEqual(x, y)) out.push(path || '(root)');
  };
  walk(a, b, prefix);
  return out;
}
