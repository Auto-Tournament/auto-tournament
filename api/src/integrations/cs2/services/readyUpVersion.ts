/**
 * Ready Up plugin version status (pure; no network).
 *
 * Ready Up servers report their version in the fleet `hello`
 * (`versions.core`). Unlike the old cs2-plugin, Ready Up may have no GitHub
 * release at all; while none exists there is nothing to compare against, so
 * the status is `unknown` and the UI must not warn.
 */

import semver, { type SemVer } from 'semver';

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

/**
 * Parse a Ready Up version string into a semver. Accepts `1.2.3`, `v1.2.3`,
 * pre-releases (`1.2.3-beta.1`), and trailing build info: `+build` metadata or
 * whitespace + `(sha)` as Ready Up's hello reports (`0.1.0 (4e42de0)`).
 * Returns null when it is not a semver.
 */
export function parseVersion(v: string): SemVer | null {
  if (typeof v !== 'string') return null;
  const head = v.trim().split(/\s+/)[0] ?? '';
  return semver.parse(head.replace(/^v/i, ''));
}

/** -1 / 0 / 1 by semver precedence, or null when either side is not a semver. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  return pa.compare(pb);
}

/** True when the version parses and is a semver pre-release. */
export function isPrereleaseVersion(v: string | null | undefined): boolean {
  const p = v ? parseVersion(v) : null;
  return !!p && p.prerelease.length > 0;
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
