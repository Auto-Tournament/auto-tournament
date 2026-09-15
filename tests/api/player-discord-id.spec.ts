import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import {
  signInViaRequest,
  signInAsPlayerViaRequest,
  impersonatePlayer,
  stopImpersonating,
} from '../helpers/auth';
import { createShuffleTournament, registerPlayers } from '../helpers/shuffleTournament';
import {
  isValidDiscordId,
  normalisePlayerDiscordIds,
  parseDiscordIdEdit,
  redactDiscordIdsInPath,
} from '../../api/src/utils/discordId';

/**
 * A player's Discord ID.
 *
 * Contact data, stored in `players.discord_id`, so admins and the Discord bot
 * can reach a player. It is not a login and is never linked to an identity.
 * Some players are children, so the tests that matter most are the privacy
 * ones: the ID must not come out of any public endpoint, or out of the roster
 * JSON that public pages read.
 *
 * Two write rules:
 * - an explicit edit (admin, player self-service) overwrites, and a bad value
 *   is a 400;
 * - an import (team write, bulk player import) only fills a blank, and a bad
 *   value is a warning.
 *
 * Tests never sign in with a browser: the admin session goes on the `request`
 * fixture, and a fresh cookie-less context stands in for the public.
 *
 * @tag api
 * @tag players
 * @tag teams
 */

const READONLY_TOKEN = (
  process.env.API_TOKENS_READONLY || 'ci-readonly:ci-readonly-token-0123456789abcdef'
)
  .split(/[\s,;]+/)[0]
  .split(':')
  .slice(1)
  .join(':');

let counter = 0;

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

/** A Steam64-shaped ID no other test uses (never ...0001 / ...0002). */
function uniqueSteamId(): string {
  counter = (counter + 1) % 100;
  return `765611980${Date.now().toString().slice(-6)}${counter.toString().padStart(2, '0')}`;
}

/** An 18-digit Discord snowflake no other test uses. */
function uniqueDiscordId(): string {
  return `1${Date.now().toString().slice(-8)}${digits(9)}`;
}

function uniqueTeamId(label: string): string {
  return `pdid-${label}-${Date.now()}-${digits(4)}`;
}

interface AdminPlayer {
  id: string;
  name: string;
  discordId: string | null;
}

interface RosterPlayer {
  steamId: string;
  name: string;
  discordId?: string | null;
}

interface TeamWrite {
  success: boolean;
  warnings?: string[];
  team?: { id: string; players: RosterPlayer[] };
}

function discordWarnings(body: { warnings?: string[] }): string[] {
  return (body.warnings ?? []).filter((w) => w.includes('Discord'));
}

async function signInAdmin(request: APIRequestContext): Promise<void> {
  expect(await signInViaRequest(request)).toBe(true);
}

async function adminCreatePlayer(
  request: APIRequestContext,
  data: Record<string, unknown>
): Promise<AdminPlayer> {
  const res = await request.post('/api/players', { data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { player: AdminPlayer }).player;
}

async function storedDiscordId(request: APIRequestContext, steamId: string): Promise<string | null> {
  const res = await request.get('/api/players');
  expect(res.ok()).toBe(true);
  const { players } = (await res.json()) as { players: AdminPlayer[] };
  const player = players.find((p) => p.id === steamId);
  expect(player, `player ${steamId} missing from admin list`).toBeTruthy();
  return player!.discordId;
}

async function setDiscordIdAsAdmin(
  request: APIRequestContext,
  steamId: string,
  discordId: string | null
): Promise<void> {
  const res = await request.put(`/api/players/${steamId}`, { data: { discordId } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function postTeam(
  request: APIRequestContext,
  id: string,
  players: Array<RosterPlayer | Record<string, unknown>>,
  query = ''
): Promise<TeamWrite> {
  const res = await request.post(`/api/teams${query}`, {
    data: { id, name: `Team ${id}`, players },
  });
  expect(res.ok(), `team write failed: ${await res.text()}`).toBe(true);
  return (await res.json()) as TeamWrite;
}

async function publicContext(playwright: Playwright): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
  });
}

// ---------------------------------------------------------------------------
// 1. Pure validation
// ---------------------------------------------------------------------------

test.describe('Discord ID validation (pure)', () => {
  test('accepts 17–20 digit strings and nothing else', () => {
    expect(isValidDiscordId('1'.repeat(17))).toBe(true);
    expect(isValidDiscordId('123456789012345678')).toBe(true);
    expect(isValidDiscordId('1'.repeat(20))).toBe(true);

    expect(isValidDiscordId('1'.repeat(16))).toBe(false);
    expect(isValidDiscordId('1'.repeat(21))).toBe(false);
    expect(isValidDiscordId('12345678901234567a')).toBe(false);
    expect(isValidDiscordId('ola.gamer')).toBe(false);
    expect(isValidDiscordId(123456789012345678)).toBe(false);
    expect(isValidDiscordId('')).toBe(false);
    expect(isValidDiscordId(undefined)).toBe(false);
  });

  test('an explicit edit: set, clear, absent, invalid', () => {
    expect(parseDiscordIdEdit(' 123456789012345678 ')).toEqual({
      kind: 'set',
      value: '123456789012345678',
    });
    expect(parseDiscordIdEdit(undefined)).toEqual({ kind: 'absent' });
    expect(parseDiscordIdEdit(null)).toEqual({ kind: 'clear' });
    expect(parseDiscordIdEdit('')).toEqual({ kind: 'clear' });
    expect(parseDiscordIdEdit('   ')).toEqual({ kind: 'clear' });
    expect(parseDiscordIdEdit('1'.repeat(16)).kind).toBe('invalid');
    expect(parseDiscordIdEdit('ola#1234').kind).toBe('invalid');

    // JSON.parse has already rounded this; turning it back into a string would
    // store a different, valid-looking ID.
    const numeric = parseDiscordIdEdit(JSON.parse('123456789012345678'));
    expect(numeric.kind).toBe('invalid');
    expect(numeric.kind === 'invalid' && numeric.error).toContain('number');
  });

  test('request paths are logged with the Discord ID abbreviated', () => {
    expect(redactDiscordIdsInPath('/by-discord-id/123456789012345678')).toBe('/by-discord-id/1234…');
    expect(redactDiscordIdsInPath('/api/players/by-discord-id/123456789012345678')).toBe(
      '/api/players/by-discord-id/1234…'
    );
    expect(redactDiscordIdsInPath('/api/players/76561198000000010')).toBe(
      '/api/players/76561198000000010'
    );
  });

  test('an import: valid IDs split off, invalid dropped with a warning, blank ignored', () => {
    const { players, discordIds, warnings } = normalisePlayerDiscordIds([
      { steamId: '76561198000000010', name: 'Valid', discordId: ' 123456789012345678 ' },
      { steamId: '76561198000000011', name: 'Short', discordId: '1234567890123456' },
      { steamId: '76561198000000012', name: 'Username', discordId: 'ola.gamer' },
      { steamId: '76561198000000013', name: 'Absent' },
      { steamId: '76561198000000014', name: 'Empty', discordId: '' },
      { steamId: '76561198000000015', name: 'Null', discordId: null },
      ...(JSON.parse(
        '[{"steamId":"76561198000000016","name":"Number","discordId":123456789012345678}]'
      ) as Array<{ steamId: string; name: string }>),
    ]);

    // The roster that gets stored never carries the key, valid or not.
    expect(players.every((p) => !('discordId' in p))).toBe(true);
    expect(discordIds).toEqual([
      { steamId: '76561198000000010', name: 'Valid', discordId: '123456789012345678' },
    ]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('"Short"');
    expect(warnings[1]).toContain('"Username"');
    expect(warnings[2]).toContain('number');
  });
});

// ---------------------------------------------------------------------------
// 2. Admin edits
// ---------------------------------------------------------------------------

test.describe('Discord ID: admin edits', () => {
  test.beforeEach(async ({ request }) => {
    await signInAdmin(request);
  });

  test('create with, update, clear, and list', async ({ request }) => {
    const steamId = uniqueSteamId();
    const first = uniqueDiscordId();
    const second = uniqueDiscordId();

    const created = await adminCreatePlayer(request, {
      id: steamId,
      name: 'Admin Edit',
      discordId: first,
    });
    expect(created.discordId).toBe(first);
    expect(await storedDiscordId(request, steamId)).toBe(first);

    const updateRes = await request.put(`/api/players/${steamId}`, { data: { discordId: second } });
    expect(updateRes.ok()).toBe(true);
    expect(((await updateRes.json()) as { player: AdminPlayer }).player.discordId).toBe(second);

    // Absent key leaves it alone.
    const renameRes = await request.put(`/api/players/${steamId}`, { data: { name: 'Renamed' } });
    expect(((await renameRes.json()) as { player: AdminPlayer }).player.discordId).toBe(second);

    const clearRes = await request.put(`/api/players/${steamId}`, { data: { discordId: null } });
    expect(((await clearRes.json()) as { player: AdminPlayer }).player.discordId).toBeNull();
    expect(await storedDiscordId(request, steamId)).toBeNull();

    await setDiscordIdAsAdmin(request, steamId, first);
    const emptyRes = await request.put(`/api/players/${steamId}`, { data: { discordId: '' } });
    expect(((await emptyRes.json()) as { player: AdminPlayer }).player.discordId).toBeNull();
  });

  test('an invalid value is a 400 and changes nothing', async ({ request }) => {
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    await adminCreatePlayer(request, { id: steamId, name: 'Invalid Edit', discordId });

    for (const bad of ['ola.gamer', '1'.repeat(16), '1'.repeat(21)]) {
      const res = await request.put(`/api/players/${steamId}`, {
        data: { name: 'Should Not Apply', discordId: bad },
      });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('Discord');
    }

    // A JSON number, written raw so it is not a string on the wire.
    const numeric = await request.put(`/api/players/${steamId}`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"discordId":123456789012345678}',
    });
    expect(numeric.status()).toBe(400);

    expect(await storedDiscordId(request, steamId)).toBe(discordId);
    const list = await request.get('/api/players');
    const { players } = (await list.json()) as { players: AdminPlayer[] };
    expect(players.find((p) => p.id === steamId)!.name).toBe('Invalid Edit');

    const createRes = await request.post('/api/players', {
      data: { id: uniqueSteamId(), name: 'Bad Create', discordId: 'nope' },
    });
    expect(createRes.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3. Team imports
// ---------------------------------------------------------------------------

test.describe('Discord ID: team imports', () => {
  test.beforeEach(async ({ request }) => {
    await signInAdmin(request);
  });

  test('fills a new player, and is not stored in the roster JSON', async ({
    request,
    playwright,
  }) => {
    const teamId = uniqueTeamId('fill');
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();

    const body = await postTeam(request, teamId, [{ steamId, name: 'Ola', discordId }]);
    expect(discordWarnings(body)).toEqual([]);
    expect(await storedDiscordId(request, steamId)).toBe(discordId);

    const res = await request.get(`/api/teams/${teamId}`);
    const { team } = (await res.json()) as { team: { players: RosterPlayer[] } };
    expect(team.players[0].discordId).toBe(discordId);

    // GET enriches from the players table. Clear the table value: if the ID were
    // also in the roster JSON, it would still come back.
    await setDiscordIdAsAdmin(request, steamId, null);
    const again = await request.get(`/api/teams/${teamId}`);
    const reread = (await again.json()) as { team: { players: RosterPlayer[] } };
    expect(reread.team.players[0].discordId).toBeNull();

    // The public team page reads the raw roster JSON.
    await setDiscordIdAsAdmin(request, steamId, discordId);
    const anon = await publicContext(playwright);
    try {
      const pub = await anon.get(`/api/team/${teamId}/match`);
      expect(await pub.text()).not.toContain(discordId);
    } finally {
      await anon.dispose();
    }
  });

  test('never overwrites: a different value warns, the same value is silent', async ({
    request,
  }) => {
    const steamId = uniqueSteamId();
    const onFile = uniqueDiscordId();
    const imported = uniqueDiscordId();
    await adminCreatePlayer(request, { id: steamId, name: 'Kari', discordId: onFile });

    const different = await postTeam(request, uniqueTeamId('diff'), [
      { steamId, name: 'Kari', discordId: imported },
    ]);
    const warnings = discordWarnings(different);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Kari"');
    expect(warnings[0]).toContain(`${onFile.slice(0, 4)}…`);
    expect(warnings[0]).toContain(`${imported.slice(0, 4)}…`);
    expect(warnings[0]).toContain('kept the existing one');
    // Abbreviated, not the full IDs.
    expect(warnings[0]).not.toContain(onFile);
    expect(warnings[0]).not.toContain(imported);
    expect(await storedDiscordId(request, steamId)).toBe(onFile);

    const same = await postTeam(request, uniqueTeamId('same'), [
      { steamId, name: 'Kari', discordId: onFile },
    ]);
    expect(discordWarnings(same)).toEqual([]);
  });

  test('an import without a Discord ID does not clear one', async ({ request }) => {
    const teamId = uniqueTeamId('noclear');
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    await adminCreatePlayer(request, { id: steamId, name: 'Per', discordId });

    await postTeam(request, teamId, [{ steamId, name: 'Per' }]);
    expect(await storedDiscordId(request, steamId)).toBe(discordId);

    const put = await request.put(`/api/teams/${teamId}`, {
      data: { players: [{ steamId, name: 'Per', discordId: null }] },
    });
    expect(put.ok()).toBe(true);
    expect(await storedDiscordId(request, steamId)).toBe(discordId);
  });

  test('an invalid value is dropped with a warning and the import succeeds', async ({
    request,
  }) => {
    const teamId = uniqueTeamId('invalid');
    const a = uniqueSteamId();
    const b = uniqueSteamId();

    const res = await request.post('/api/teams', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        id: teamId,
        name: 'Invalid IDs',
        players: [
          { steamId: a, name: 'Username', discordId: 'per.gamer' },
          { steamId: b, name: 'Numeric', discordId: 123456789012345678 },
        ],
      }),
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as TeamWrite;
    const warnings = discordWarnings(body);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('number');
    expect(await storedDiscordId(request, a)).toBeNull();
    expect(await storedDiscordId(request, b)).toBeNull();
  });

  test('PUT fills a blank and warns on a conflict', async ({ request }) => {
    const teamId = uniqueTeamId('put');
    const blank = uniqueSteamId();
    const taken = uniqueSteamId();
    const takenId = uniqueDiscordId();
    const newId = uniqueDiscordId();

    await postTeam(request, teamId, [
      { steamId: blank, name: 'Blank' },
      { steamId: taken, name: 'Taken' },
    ]);
    await setDiscordIdAsAdmin(request, taken, takenId);

    const res = await request.put(`/api/teams/${teamId}`, {
      data: {
        players: [
          { steamId: blank, name: 'Blank', discordId: newId },
          { steamId: taken, name: 'Taken', discordId: newId },
        ],
      },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as TeamWrite;
    expect(discordWarnings(body)).toHaveLength(1);
    expect(discordWarnings(body)[0]).toContain('"Taken"');
    expect(body.team!.players.find((p) => p.steamId === blank)!.discordId).toBe(newId);
    expect(await storedDiscordId(request, blank)).toBe(newId);
    expect(await storedDiscordId(request, taken)).toBe(takenId);
  });

  test('array POST and PATCH batch prefix warnings with the team', async ({ request }) => {
    const steamId = uniqueSteamId();
    const onFile = uniqueDiscordId();
    await adminCreatePlayer(request, { id: steamId, name: 'Batch', discordId: onFile });

    const teamA = uniqueTeamId('arr');
    const arrayRes = await request.post('/api/teams', {
      data: [
        {
          id: teamA,
          name: 'Array Team',
          players: [{ steamId, name: 'Batch', discordId: uniqueDiscordId() }],
        },
      ],
    });
    expect(arrayRes.status(), await arrayRes.text()).toBe(201);
    const arrayBody = (await arrayRes.json()) as {
      warnings?: string[];
      successful: Array<{ players: RosterPlayer[] }>;
    };
    expect(discordWarnings(arrayBody)).toHaveLength(1);
    expect(discordWarnings(arrayBody)[0].startsWith(`Team '${teamA}': `)).toBe(true);
    expect(arrayBody.successful[0].players[0].discordId).toBe(onFile);

    const patchRes = await request.patch('/api/teams/batch', {
      data: [
        {
          id: teamA,
          updates: { players: [{ steamId, name: 'Batch', discordId: 'bad-value' }] },
        },
      ],
    });
    expect(patchRes.status(), await patchRes.text()).toBe(200);
    const patchBody = (await patchRes.json()) as { warnings?: string[] };
    expect(discordWarnings(patchBody)).toHaveLength(1);
    expect(discordWarnings(patchBody)[0].startsWith(`Team '${teamA}': `)).toBe(true);
    expect(await storedDiscordId(request, steamId)).toBe(onFile);

    // No warnings → no key, as before.
    const quiet = await request.patch('/api/teams/batch', {
      data: [{ id: teamA, updates: { players: [{ steamId, name: 'Batch' }] } }],
    });
    expect('warnings' in ((await quiet.json()) as object)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Bulk player import
// ---------------------------------------------------------------------------

test.describe('Discord ID: bulk player import', () => {
  test.beforeEach(async ({ request }) => {
    await signInAdmin(request);
  });

  test('follows the import rule, with warnings', async ({ request }) => {
    const fresh = uniqueSteamId();
    const blank = uniqueSteamId();
    const taken = uniqueSteamId();
    const invalid = uniqueSteamId();
    const freshId = uniqueDiscordId();
    const blankId = uniqueDiscordId();
    const takenId = uniqueDiscordId();

    await adminCreatePlayer(request, { id: blank, name: 'Blank' });
    await adminCreatePlayer(request, { id: taken, name: 'Taken', discordId: takenId });

    const res = await request.post('/api/players/bulk-import', {
      data: [
        { id: fresh, name: 'Fresh', discordId: freshId },
        { id: blank, name: 'Blank', discordId: blankId },
        { id: taken, name: 'Taken', discordId: uniqueDiscordId() },
        { id: invalid, name: 'Invalid', discordId: 'x' },
      ],
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as {
      created: number;
      updated: number;
      errors: unknown[];
      warnings?: string[];
    };
    expect(body.created).toBe(2);
    expect(body.updated).toBe(2);
    expect(body.errors).toEqual([]);
    expect(body.warnings).toHaveLength(2);
    expect(body.warnings!.some((w) => w.includes('"Taken"') && w.includes('kept'))).toBe(true);
    expect(body.warnings!.some((w) => w.includes('"Invalid"'))).toBe(true);

    expect(await storedDiscordId(request, fresh)).toBe(freshId);
    expect(await storedDiscordId(request, blank)).toBe(blankId);
    expect(await storedDiscordId(request, taken)).toBe(takenId);
    expect(await storedDiscordId(request, invalid)).toBeNull();

    // Re-import without the field: nothing cleared, no warnings key.
    const again = await request.post('/api/players/bulk-import', {
      data: [{ id: fresh, name: 'Fresh' }],
    });
    expect('warnings' in ((await again.json()) as object)).toBe(false);
    expect(await storedDiscordId(request, fresh)).toBe(freshId);
  });
});

// ---------------------------------------------------------------------------
// 5. Player self-service
// ---------------------------------------------------------------------------

test.describe('Discord ID: player self-service', () => {
  test('a player sets, reads and clears their own', async ({ request, playwright }) => {
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    expect(await signInAsPlayerViaRequest(request, steamId)).toBe(true);

    const empty = await request.get('/api/players/me/discord-id');
    expect(empty.status()).toBe(200);
    expect(await empty.json()).toMatchObject({ steamId, discordId: null });

    const put = await request.put('/api/players/me/discord-id', { data: { discordId } });
    expect(put.status(), await put.text()).toBe(200);
    expect(await put.json()).toMatchObject({ steamId, discordId });

    const read = await request.get('/api/players/me/discord-id');
    expect(await read.json()).toMatchObject({ steamId, discordId });

    const clear = await request.put('/api/players/me/discord-id', { data: { discordId: null } });
    expect(await clear.json()).toMatchObject({ steamId, discordId: null });

    // The player is not an admin, and self-service did not make them one.
    const adminList = await request.get('/api/players');
    expect(adminList.status()).toBe(403);

    // The admin sees what the player saved.
    await request.put('/api/players/me/discord-id', { data: { discordId } });
    const admin = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await signInAdmin(admin);
      expect(await storedDiscordId(admin, steamId)).toBe(discordId);
    } finally {
      await admin.dispose();
    }
  });

  test('invalid values are a 400', async ({ request }) => {
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    expect(await signInAsPlayerViaRequest(request, steamId)).toBe(true);
    await request.put('/api/players/me/discord-id', { data: { discordId } });

    for (const bad of ['ola#1234', '1'.repeat(16)]) {
      const res = await request.put('/api/players/me/discord-id', { data: { discordId: bad } });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBeTruthy();
    }

    const numeric = await request.put('/api/players/me/discord-id', {
      headers: { 'Content-Type': 'application/json' },
      data: '{"discordId":123456789012345678}',
    });
    expect(numeric.status()).toBe(400);

    const missing = await request.put('/api/players/me/discord-id', { data: {} });
    expect(missing.status()).toBe(400);

    const read = await request.get('/api/players/me/discord-id');
    expect(await read.json()).toMatchObject({ discordId });
  });

  test('not signed in is a 401', async ({ request }) => {
    const get = await request.get('/api/players/me/discord-id');
    expect(get.status()).toBe(401);
    const put = await request.put('/api/players/me/discord-id', {
      data: { discordId: uniqueDiscordId() },
    });
    expect(put.status()).toBe(401);
    expect(((await put.json()) as { error: string }).error).toBeTruthy();

    // A service token is not a player.
    const token = await request.get('/api/players/me/discord-id', {
      headers: { Authorization: `Bearer ${READONLY_TOKEN}` },
    });
    expect(token.status()).toBe(401);
  });

  test('an impersonating admin is refused on GET and PUT', async ({ request }) => {
    await signInAdmin(request);
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    await adminCreatePlayer(request, { id: steamId, name: 'Impersonated', discordId });

    expect(await impersonatePlayer(request, steamId)).toBe(true);
    try {
      const get = await request.get('/api/players/me/discord-id');
      expect(get.status()).toBe(403);
      expect(((await get.json()) as { error: string }).error).toContain('Players page');

      const put = await request.put('/api/players/me/discord-id', {
        data: { discordId: uniqueDiscordId() },
      });
      expect(put.status()).toBe(403);
    } finally {
      await stopImpersonating(request);
    }

    expect(await storedDiscordId(request, steamId)).toBe(discordId);
  });

  test("a player's PUT only changes their own record", async ({ request, playwright }) => {
    const other = uniqueSteamId();
    const otherId = uniqueDiscordId();
    const admin = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await signInAdmin(admin);
      await adminCreatePlayer(admin, { id: other, name: 'Other', discordId: otherId });

      const me = uniqueSteamId();
      const myId = uniqueDiscordId();
      expect(await signInAsPlayerViaRequest(request, me)).toBe(true);

      // Extra keys cannot redirect the write.
      const put = await request.put('/api/players/me/discord-id', {
        data: { discordId: myId, steamId: other, id: other },
      });
      expect(await put.json()).toMatchObject({ steamId: me, discordId: myId });

      expect(await storedDiscordId(admin, me)).toBe(myId);
      expect(await storedDiscordId(admin, other)).toBe(otherId);
    } finally {
      await admin.dispose();
    }
  });

  test('a signed-in Steam account without a player row is a 404', async ({
    request,
    playwright,
  }) => {
    const steamId = uniqueSteamId();
    expect(await signInAsPlayerViaRequest(request, steamId)).toBe(true);

    // The signed cookie outlives the row it was issued for.
    const admin = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await signInAdmin(admin);
      const del = await admin.delete(`/api/players/${steamId}`);
      expect(del.ok()).toBe(true);
    } finally {
      await admin.dispose();
    }

    expect((await request.get('/api/players/me/discord-id')).status()).toBe(404);
    const put = await request.put('/api/players/me/discord-id', {
      data: { discordId: uniqueDiscordId() },
    });
    expect(put.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 6. Lookup for the Discord bot
// ---------------------------------------------------------------------------

test.describe('Discord ID: lookup by Discord ID', () => {
  test('finds players, including several sharing one ID', async ({ request }) => {
    await signInAdmin(request);
    const shared = uniqueDiscordId();
    const child1 = uniqueSteamId();
    const child2 = uniqueSteamId();

    await adminCreatePlayer(request, { id: child1, name: 'Child One' });
    await setDiscordIdAsAdmin(request, child1, shared);

    const one = await request.get(`/api/players/by-discord-id/${shared}`);
    expect(one.status()).toBe(200);
    const oneBody = (await one.json()) as { success: boolean; players: AdminPlayer[] };
    expect(oneBody.success).toBe(true);
    expect(oneBody.players.map((p) => p.id)).toEqual([child1]);
    expect(oneBody.players[0].discordId).toBe(shared);

    await adminCreatePlayer(request, { id: child2, name: 'Child Two', discordId: shared });
    const both = await request.get(`/api/players/by-discord-id/${shared}`);
    const bothBody = (await both.json()) as { players: AdminPlayer[] };
    expect(bothBody.players.map((p) => p.id).sort()).toEqual([child1, child2].sort());
  });

  test('unknown is an empty array, invalid is a 400', async ({ request }) => {
    await signInAdmin(request);
    const unknown = await request.get(`/api/players/by-discord-id/${uniqueDiscordId()}`);
    expect(unknown.status()).toBe(200);
    expect(await unknown.json()).toEqual({ success: true, players: [] });

    for (const bad of ['1234', 'ola.gamer', '1'.repeat(21)]) {
      const res = await request.get(`/api/players/by-discord-id/${bad}`);
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBeTruthy();
    }
  });

  test('a read-only service token can look up but not edit; no auth is a 401', async ({
    request,
    playwright,
  }) => {
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    const admin = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await signInAdmin(admin);
      await adminCreatePlayer(admin, { id: steamId, name: 'Bot Lookup', discordId });
    } finally {
      await admin.dispose();
    }

    const auth = { Authorization: `Bearer ${READONLY_TOKEN}` };
    const res = await request.get(`/api/players/by-discord-id/${discordId}`, { headers: auth });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { players: AdminPlayer[] };
    expect(body.players.map((p) => p.id)).toEqual([steamId]);

    const put = await request.put(`/api/players/${steamId}`, {
      headers: auth,
      data: { discordId: null },
    });
    expect(put.status()).toBe(403);

    const anon = await request.get(`/api/players/by-discord-id/${discordId}`);
    expect(anon.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 7. Privacy: never in a public response
// ---------------------------------------------------------------------------

test.describe('Discord ID: privacy', () => {
  test('does not appear in any public player or team endpoint', async ({
    request,
    playwright,
  }) => {
    await signInAdmin(request);
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    const teamId = uniqueTeamId('privacy');

    await postTeam(request, teamId, [{ steamId, name: 'Private Child', discordId }]);
    expect(await storedDiscordId(request, steamId)).toBe(discordId);

    const anon = await publicContext(playwright);
    try {
      const paths = [
        `/api/players/find?query=${steamId}`,
        `/api/players/find?steamId=${steamId}`,
        `/api/players/${steamId}`,
        `/api/players/${steamId}/summary`,
        `/api/players/${steamId}/team`,
        `/api/players/${steamId}/current-match`,
        `/api/players/public-selection`,
        `/api/team/${teamId}/match`,
      ];
      for (const path of paths) {
        const res = await anon.get(path);
        const text = await res.text();
        expect(text, `${path} leaked the Discord ID`).not.toContain(discordId);
        expect(text, `${path} leaked discordId`).not.toContain('discordId');
        expect(text, `${path} leaked discord_id`).not.toContain('discord_id');
      }

      // The lookup itself is not public.
      expect((await anon.get(`/api/players/by-discord-id/${discordId}`)).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('admin tournament players list does not leak the raw column', async ({ request }) => {
    await signInAdmin(request);
    const steamId = uniqueSteamId();
    const discordId = uniqueDiscordId();
    await adminCreatePlayer(request, { id: steamId, name: 'Registered Child', discordId });

    const tournament = await createShuffleTournament(request, { name: `Discord privacy ${Date.now()}` });
    expect(tournament).toBeTruthy();
    const registered = await registerPlayers(request, [steamId]);
    expect(registered?.registered).toBe(1);

    const res = await request.get('/api/tournament/1/players');
    expect(res.ok()).toBe(true);
    const text = await res.text();
    expect(text).toContain(steamId);
    expect(text).not.toContain('discord_id');
    expect(text).not.toContain(discordId);
  });
});
