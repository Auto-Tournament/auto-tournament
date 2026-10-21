/**
 * Which of the permissions the bot needs (the invite link asks for them,
 * interactions.ts) it does not have on its server, kept apart from Discord so
 * it can be checked on its own.
 */

const ADMINISTRATOR = 1n << 3n;

/** What the bot needs, by Discord's names (the same bits as the invite link). */
export const NEEDED: ReadonlyArray<readonly [bigint, string]> = [
  [1n << 0n, 'Create Invite'],
  [1n << 4n, 'Manage Channels'],
  [1n << 10n, 'View Channels'],
  [1n << 11n, 'Send Messages'],
  [1n << 14n, 'Embed Links'],
  [1n << 20n, 'Connect'],
  [1n << 24n, 'Move Members'],
  [1n << 28n, 'Manage Roles'],
];

/** The needed permissions the bot's roles (and @everyone, whose id is the server's) lack (pure). */
export function missingPermissions(
  guildId: string,
  memberRoles: string[],
  roles: Array<{ id: string; permissions: string }>
): string[] {
  const mine = new Set([guildId, ...memberRoles]);
  const have = roles
    .filter((r) => mine.has(r.id))
    .reduce((all, r) => all | BigInt(r.permissions || '0'), 0n);
  if (have & ADMINISTRATOR) return [];
  return NEEDED.filter(([bit]) => (have & bit) === 0n).map(([, name]) => name);
}
