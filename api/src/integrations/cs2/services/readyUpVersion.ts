/**
 * Ready Up plugin version status (pure; no network).
 *
 * Ready Up servers report their version in the fleet `hello`
 * (`versions.core`). Unlike the old cs2-plugin, Ready Up may have no GitHub
 * release at all; while none exists there is nothing to compare against, so
 * the status is `unknown` and the UI must not warn.
 */

export type ReadyUpUpdateState = 'unknown' | 'current' | 'outdated';

export interface ReadyUpUpdateStatus {
  state: ReadyUpUpdateState;
  /** What the server runs (hello.versions.core), if it has said. */
  running: string | null;
  /** Latest release of Auto-Tournament/ready-up, or null while none exists. */
  latest: string | null;
  releaseUrl: string | null;
}

export interface ReadyUpRelease {
  version: string;
  releaseUrl: string;
}

function parseVersion(v: string): number[] | null {
  const cleaned = v.trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = cleaned.split('.').map((p) => (p === '' ? NaN : Number(p)));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/** -1 / 0 / 1, or null when either side is not a dotted number version. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/**
 * `outdated` only when a release exists AND the running version is strictly
 * older. No release, no reported version, or an unparseable/newer version is
 * never a warning.
 */
export function readyUpUpdateStatus(
  running: string | null | undefined,
  latest: ReadyUpRelease | null
): ReadyUpUpdateStatus {
  const runningVersion = running && running.trim() ? running.trim() : null;
  if (!latest) {
    return { state: 'unknown', running: runningVersion, latest: null, releaseUrl: null };
  }
  const base = { running: runningVersion, latest: latest.version, releaseUrl: latest.releaseUrl };
  if (!runningVersion) return { state: 'unknown', ...base };
  const cmp = compareVersions(runningVersion, latest.version);
  if (cmp === null) return { state: 'unknown', ...base };
  return { state: cmp < 0 ? 'outdated' : 'current', ...base };
}
