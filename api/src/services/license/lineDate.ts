/**
 * The running build's `line_date`: the release date of its version line
 * (x.y.0). A license covers a release when `line_date <= updates_until`, so
 * later patches of a covered line stay covered after the updates end.
 *
 * Baked in at build time (api/esbuild.config.js):
 * - `__AT_BUILD_DATE__`: the day the bundle was built (UTC, YYYY-MM-DD).
 * - `__AT_LINE_RELEASE_DATE__`: the day vX.Y.0 was released, which the
 *   release workflow reads from the tag and passes as `AT_LINE_RELEASE_DATE`.
 *   Empty for an x.y.0 release itself (not tagged yet) and for other builds.
 * Running from source (tsx) has neither: the line date is today.
 */

declare const __AT_BUILD_DATE__: string | undefined;
declare const __AT_LINE_RELEASE_DATE__: string | undefined;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The line date for `version`:
 * - an x.y.0 (a new line, its betas included), an unparseable version, or a
 *   patch whose x.y.0 date is unknown: the build date;
 * - a patch (x.y.z, z > 0) with the x.y.0 release date: that date, but never
 *   later than the build date.
 */
export function lineDateFor(
  version: string,
  dates: { buildDate: string; lineReleaseDate?: string | null }
): string {
  const { buildDate, lineReleaseDate } = dates;
  const match = VERSION.exec(version.trim());
  if (!match || Number(match[3]) === 0) return buildDate;
  if (!isDate(lineReleaseDate)) return buildDate;
  return lineReleaseDate < buildDate ? lineReleaseDate : buildDate;
}

/** The running build's line date. */
export function buildLineDate(version: string, today: Date = new Date()): string {
  const baked = typeof __AT_BUILD_DATE__ !== 'undefined' ? __AT_BUILD_DATE__ : undefined;
  const buildDate = isDate(baked) ? baked : today.toISOString().slice(0, 10);
  const lineReleaseDate =
    typeof __AT_LINE_RELEASE_DATE__ !== 'undefined' ? __AT_LINE_RELEASE_DATE__ : undefined;
  return lineDateFor(version, { buildDate, lineReleaseDate });
}
