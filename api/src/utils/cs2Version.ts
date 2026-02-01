/**
 * CS2 version helpers
 */

/**
 * Parse a CS2 server version identifier that can be sent to Steam UpToDateCheck.
 *
 * Notes:
 * - Historically we tried to parse a literal "BuildID" from the `version` command output.
 * - Some server environments only return "Protocol version ..." for `version`, but the
 *   RCON `status` output includes a usable value in the form `version  : 1.41.3.4/14134 ...`,
 *   where the trailing integer matches Steam's `required_version`.
 *
 * This helper accepts either kind of output and returns the best-effort integer.
 */
export function parseCs2BuildId(versionOutput: string): number | null {
  // 1) "BuildID 1234567", "BuildId: 1234567", "Build ID=1234567" (tolerate spacing/separators)
  const m = versionOutput.match(/\bBuild\s*ID\b\s*[:=\s]+(\d{4,})/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  // 2) `status` output line: `version  : 1.41.3.4/14134 ...`
  // We extract the trailing integer after `/`.
  const status = versionOutput.match(/^\s*version\s*:\s*[0-9.]+\s*\/\s*(\d{4,})\b/im);
  if (status?.[1]) {
    const n = Number(status[1]);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

/**
 * Extract a compact, human-readable CS2 version string from `status` output.
 * Returns the full `version  : ...` line, if present.
 */
export function extractCs2StatusVersionLine(statusOutput: string): string | null {
  const m = statusOutput.match(/^\s*(version\s*:\s*.+)$/im);
  return m?.[1]?.trim() ? m[1].trim() : null;
}

