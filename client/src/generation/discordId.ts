/**
 * Plausible Discord snowflakes, for generated test data.
 *
 * A bot that looks a player up by their Discord ID (`GET
 * /api/players/by-discord-id/:id`) has nothing to find on a fresh dev
 * instance, because generated players had no Discord IDs at all — every
 * lookup answered `[]`, which is a real answer and therefore indistinguishable
 * from a broken one. So the test data now carries them.
 *
 * A snowflake is a 64-bit id whose top 42 bits are milliseconds since
 * 2015-01-01, so a real one is 17–19 digits and an account's id sorts by when
 * it was made. These are built the same way, from a random moment in the last
 * few years, which keeps them in the range `isValidDiscordId` accepts and
 * makes them look like what a bot will actually receive.
 *
 * They are random, not unique by construction. Two players sharing one is
 * fine and worth seeing: an ID is not unique in this platform either (a parent
 * may list theirs on several children), which is exactly why the lookup
 * returns an array.
 */

/** Discord's epoch: 2015-01-01T00:00:00Z, in milliseconds. */
const DISCORD_EPOCH = 1420070400000;

/** Far enough back that the ids look like established accounts. */
const OLDEST_ACCOUNT_MS = 3 * 365 * 24 * 60 * 60 * 1000;

export function generateDiscordId(): string {
  const createdAt = Date.now() - Math.floor(Math.random() * OLDEST_ACCOUNT_MS);
  const timestamp = BigInt(createdAt - DISCORD_EPOCH) << 22n;
  // The low 22 bits are the worker, process and sequence counters. Random is
  // as good as anything here; nothing reads them back.
  const remainder = BigInt(Math.floor(Math.random() * 4_194_304));
  return (timestamp | remainder).toString();
}
