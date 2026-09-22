import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Identity preparation (3.0 phase C, PR 13): `linked_accounts`,
 * `schema_migrations` and `playerIdentity.resolve`.
 *
 * - The backfill migration is recorded once in `schema_migrations`; running
 *   the migrations again applies nothing.
 * - The backfill itself is idempotent: run twice, the second run inserts
 *   nothing and every row keeps its id.
 * - It copies one unverified `steam` row per player and one verified
 *   `discord` row per Discord sign-in (`auth_identities`). It never copies
 *   `players.discord_id` (unverified contact data) or other sign-in providers.
 * - New players and Discord sign-ins written by the app are mirrored.
 * - `resolve` answers what the old lookups answered: `players.id` for Steam,
 *   `auth_identities` for Discord.
 *
 * `linked_accounts` has no real endpoint yet, so the test-only helpers under
 * `/api/test/linked-accounts` read it and run the backfill.
 *
 * @tag api
 * @tag auth
 * @tag players
 */

const MIGRATION_ID = '2026-09-22-linked-accounts-backfill';

interface LinkedAccount {
  id: number;
  provider: string;
  externalId: string;
  verified: boolean;
  createdAt: number;
}

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

/** A Steam64-shaped ID no other test uses. */
function steamId(): string {
  return `7656119${digits(10)}`;
}

/** A Discord-shaped user id (18 digits). */
function discordId(): string {
  return `9${digits(17)}`;
}

async function linkedAccounts(
  request: APIRequestContext,
  playerId: string
): Promise<LinkedAccount[]> {
  const res = await request.get(`/api/test/linked-accounts?playerId=${playerId}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).accounts as LinkedAccount[];
}

async function backfill(
  request: APIRequestContext,
  clearPlayerId?: string
): Promise<{ steam: number; discord: number }> {
  const res = await request.post('/api/test/linked-accounts/backfill', {
    data: clearPlayerId ? { clearPlayerId } : {},
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).inserted;
}

async function resolve(
  request: APIRequestContext,
  provider: string,
  externalId: string
): Promise<string | null> {
  const res = await request.get(
    `/api/test/player-identity/resolve?provider=${provider}&externalId=${externalId}`
  );
  expect(res.ok()).toBe(true);
  return (await res.json()).playerId as string | null;
}

async function createPlayer(
  request: APIRequestContext,
  id: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const res = await request.post('/api/players', {
    data: { id, name: `Linked ${id.slice(-4)}`, ...extra },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function seedSignIn(
  request: APIRequestContext,
  provider: string,
  providerUserId: string,
  steam: string
): Promise<void> {
  const res = await request.post('/api/test/auth-identities', {
    data: { provider, providerUserId, steamId: steam },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test.describe.serial('linked_accounts and schema_migrations', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('the backfill migration is recorded once and does not run again', async ({ request }) => {
    const before = await request.get('/api/test/schema-migrations');
    expect(before.ok()).toBe(true);
    const applied = (await before.json()).applied as string[];
    expect(applied.filter((id) => id === MIGRATION_ID)).toHaveLength(1);

    const rerun = await request.post('/api/test/schema-migrations/run');
    expect(rerun.ok()).toBe(true);
    expect((await rerun.json()).applied).toEqual([]);

    const after = await request.get('/api/test/schema-migrations');
    expect((await after.json()).applied).toEqual(applied);
  });

  test('a new player gets an unverified steam row, never one from players.discord_id', async ({
    request,
  }) => {
    const id = steamId();
    const contactDiscordId = discordId();
    await createPlayer(request, id, { discordId: contactDiscordId });

    const accounts = await linkedAccounts(request, id);
    expect(
      accounts.map(({ provider, externalId, verified }) => ({ provider, externalId, verified }))
    ).toEqual([{ provider: 'steam', externalId: id, verified: false }]);

    // The contact Discord ID is not an identity: nothing resolves through it.
    expect(await resolve(request, 'discord', contactDiscordId)).toBeNull();
    expect(await resolve(request, 'steam', id)).toBe(id);
  });

  test('backfill copies steam and discord sign-ins only, and is idempotent', async ({
    request,
  }) => {
    const id = steamId();
    const discord = discordId();
    const github = `gh-${digits(8)}`;
    await createPlayer(request, id, { discordId: discordId() });
    await seedSignIn(request, 'discord', discord, id);
    await seedSignIn(request, 'github', github, id);

    // Written by the app: the steam row, and the Discord sign-in (mirrored).
    const mirrored = await linkedAccounts(request, id);
    expect(
      mirrored.map(({ provider, externalId, verified }) => ({ provider, externalId, verified }))
    ).toEqual([
      { provider: 'steam', externalId: id, verified: false },
      { provider: 'discord', externalId: discord, verified: true },
    ]);

    // Take this player back to a pre-3.0 state (no rows) and backfill.
    const first = await backfill(request, id);
    expect(first).toEqual({ steam: 1, discord: 1 });
    const backfilled = await linkedAccounts(request, id);
    expect(
      backfilled.map(({ provider, externalId, verified }) => ({ provider, externalId, verified }))
    ).toEqual([
      { provider: 'steam', externalId: id, verified: false },
      { provider: 'discord', externalId: discord, verified: true },
    ]);
    // created_at comes from the source rows, not from the backfill run.
    for (const row of backfilled) expect(row.createdAt).toBeGreaterThan(0);

    // Run twice: nothing inserted anywhere, every row unchanged, ids stable.
    const second = await backfill(request);
    expect(second).toEqual({ steam: 0, discord: 0 });
    expect(await linkedAccounts(request, id)).toEqual(backfilled);

    // GitHub is a sign-in method, not a game account.
    expect(await resolve(request, 'github', github)).toBeNull();
    expect(await resolve(request, 'discord', discord)).toBe(id);
  });

  test('resolve answers what the old lookups answered', async ({ request }) => {
    const owner = steamId();
    const other = steamId();
    const discord = discordId();
    await createPlayer(request, owner);
    await createPlayer(request, other);
    await seedSignIn(request, 'discord', discord, owner);

    expect(await resolve(request, 'steam', owner)).toBe(owner);
    expect(await resolve(request, 'steam', steamId())).toBeNull();
    expect(await resolve(request, 'discord', discord)).toBe(owner);
    expect(await resolve(request, 'discord', discordId())).toBeNull();
    expect(await resolve(request, 'epic', owner)).toBeNull();

    // The test seeding helper re-points an identity; the mirror follows it.
    await seedSignIn(request, 'discord', discord, other);
    expect(await resolve(request, 'discord', discord)).toBe(other);
    expect((await linkedAccounts(request, owner)).map((a) => a.provider)).toEqual(['steam']);
    expect(
      (await linkedAccounts(request, other)).map(({ provider, externalId }) => ({
        provider,
        externalId,
      }))
    ).toEqual([
      { provider: 'steam', externalId: other },
      { provider: 'discord', externalId: discord },
    ]);
  });

  test('deleting a player removes its linked accounts', async ({ request }) => {
    const id = steamId();
    await createPlayer(request, id);
    await seedSignIn(request, 'discord', discordId(), id);
    expect(await linkedAccounts(request, id)).toHaveLength(2);

    const res = await request.delete(`/api/players/${id}`);
    expect(res.ok()).toBe(true);
    expect(await linkedAccounts(request, id)).toEqual([]);
  });
});
