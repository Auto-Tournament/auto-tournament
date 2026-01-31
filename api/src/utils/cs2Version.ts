/**
 * CS2 version helpers
 */

/**
 * Parse a CS2 server BuildID from RCON `version` output.
 *
 * Common patterns:
 * - "BuildID 1234567"
 * - "BuildId: 1234567"
 */
export function parseCs2BuildId(versionOutput: string): number | null {
  const m = versionOutput.match(/\bBuildID\b[:\s]+(\d{4,})/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

