/**
 * Validating a team an integrator pushes (routes/integrationTeams.ts). Pure,
 * so the tests run it in process.
 */

/** Source labels are token labels: the same pattern (utils/serviceTokens). */
export const SOURCE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** What an integrator may use as its id: printable, no spaces, 1-128 characters. */
export const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;

/** The lowest valid individual-account Steam64 id (account id 1). */
const STEAM64_MIN = 76561197960265729n;
const STEAM64_MAX = 76561202255233023n;

export function isValidSteam64(value: unknown): value is string {
  if (typeof value !== 'string' || !/^7656119\d{10}$/.test(value)) return false;
  const n = BigInt(value);
  return n >= STEAM64_MIN && n <= STEAM64_MAX;
}

export const MAX_PLAYERS = 32;
export const MAX_BATCH = 500;
const NAME_MAX = 64;
const TAG_MAX = 16;

export interface IntegrationTeamInput {
  externalId: string;
  name: string;
  tag: string | null;
  players: Array<{ steamId: string; name: string }>;
}

export class IntegrationTeamError extends Error {
  constructor(
    readonly code: 'invalid' | 'team_in_live_match' | 'not_found',
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'IntegrationTeamError';
  }
}

/** Validate one team. `externalId` comes from the path for a single upsert. */
export function parseTeamInput(raw: unknown, externalIdFromPath?: string): IntegrationTeamInput {
  const errors: string[] = [];
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const externalId = externalIdFromPath ?? body.externalId;
  if (externalIdFromPath !== undefined && body.externalId !== undefined && body.externalId !== externalIdFromPath) {
    errors.push('externalId in the body does not match the one in the path');
  }
  if (typeof externalId !== 'string' || !EXTERNAL_ID_PATTERN.test(externalId)) {
    errors.push('externalId must be 1-128 characters of letters, digits and . _ : @ -');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) errors.push('name is required');
  else if (name.length > NAME_MAX) errors.push(`name must be at most ${NAME_MAX} characters`);

  let tag: string | null = null;
  if (body.tag !== undefined && body.tag !== null) {
    if (typeof body.tag !== 'string') errors.push('tag must be a string');
    else if (body.tag.trim().length > TAG_MAX) errors.push(`tag must be at most ${TAG_MAX} characters`);
    else tag = body.tag.trim() || null;
  }

  const players: Array<{ steamId: string; name: string }> = [];
  if (!Array.isArray(body.players) || body.players.length === 0) {
    errors.push('players must be a non-empty array of { steamId, name }');
  } else if (body.players.length > MAX_PLAYERS) {
    errors.push(`players can hold at most ${MAX_PLAYERS} entries`);
  } else {
    const seen = new Set<string>();
    body.players.forEach((p, i) => {
      const player = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const steamId = player.steamId;
      if (!isValidSteam64(steamId)) {
        errors.push(
          `players[${i}].steamId must be a Steam64 id as a string (17 digits, 7656119…), got ${JSON.stringify(steamId)}`
        );
        return;
      }
      if (seen.has(steamId)) {
        errors.push(`players[${i}].steamId ${steamId} is listed twice`);
        return;
      }
      seen.add(steamId);
      const playerName = typeof player.name === 'string' ? player.name.trim() : '';
      if (!playerName) errors.push(`players[${i}].name is required`);
      else if (playerName.length > NAME_MAX) errors.push(`players[${i}].name must be at most ${NAME_MAX} characters`);
      else players.push({ steamId, name: playerName });
    });
  }

  if (errors.length > 0) {
    throw new IntegrationTeamError('invalid', 400, errors.join('; '), { errors });
  }
  return { externalId: externalId as string, name, tag, players };
}

