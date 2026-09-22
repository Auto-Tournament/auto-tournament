import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Manual reporting, schema only (3.0 phase D, PR D1).
 *
 * The tables `team_members`, `match_reports`, `match_report_actions`,
 * `custom_stat_fields` and `match_stat_values` exist with the columns, indexes
 * and foreign keys the module will rely on, and:
 *
 * - the `team_members` backfill is recorded once in `schema_migrations`;
 *   running the migrations again applies nothing;
 * - the backfill is idempotent on its own: a second run inserts nothing and
 *   the rows that are there keep their role;
 * - it makes members, never captains - 2.x has no captain or owner anywhere;
 * - a team written through the API mirrors its roster, and a roster edit
 *   follows, without demoting a captain;
 * - at most one report per match is open, revisions are unique per match, and
 *   a report needs a match that exists.
 *
 * No route or UI reads these tables yet (that is D2 onwards), so the
 * test-only helpers under `/api/test` are how a spec can see them.
 *
 * @tag api
 * @tag teams
 */

const MIGRATION_ID = '2026-09-22-team-members-backfill';

interface TeamMemberRow {
  accountUid: string;
  role: string;
  createdAt: number;
  playerId: string | null;
}

interface SchemaTable {
  columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
  indexes: Array<{ name: string; definition: string }>;
  foreignKeys: Array<{ name: string; definition: string }>;
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

async function members(request: APIRequestContext, teamId: string): Promise<TeamMemberRow[]> {
  const res = await request.get(`/api/test/team-members?teamId=${teamId}`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).members as TeamMemberRow[];
}

async function backfill(
  request: APIRequestContext,
  clearTeamId?: string
): Promise<{ members: number; teams: number; skipped: number }> {
  const res = await request.post('/api/test/team-members/backfill', {
    data: clearTeamId ? { clearTeamId } : {},
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).inserted;
}

async function schema(request: APIRequestContext): Promise<Record<string, SchemaTable>> {
  const res = await request.get('/api/test/phase-d-schema');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).tables as Record<string, SchemaTable>;
}

async function createTeamWithRoster(
  request: APIRequestContext,
  id: string,
  steamIds: string[]
): Promise<void> {
  const res = await request.post('/api/teams', {
    data: {
      id,
      name: `Report ${id.slice(-4)}`,
      players: steamIds.map((sid, i) => ({ steamId: sid, name: `Reporter ${i + 1}` })),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function setRoster(
  request: APIRequestContext,
  id: string,
  steamIds: string[]
): Promise<void> {
  const res = await request.put(`/api/teams/${id}`, {
    data: { players: steamIds.map((sid, i) => ({ steamId: sid, name: `Reporter ${i + 1}` })) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function columnNames(table: SchemaTable): string[] {
  return table.columns.map((c) => c.name);
}

test.describe.serial('manual reporting schema (phase D1)', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('the new tables have the columns the module needs', async ({ request }) => {
    const tables = await schema(request);

    expect(columnNames(tables.team_members)).toEqual(
      expect.arrayContaining(['team_id', 'account_uid', 'role', 'created_at', 'updated_at'])
    );
    // Keyed on players.uid, not on a Steam ID.
    expect(tables.team_members.columns.find((c) => c.name === 'account_uid')?.type).toBe('uuid');

    expect(columnNames(tables.match_reports)).toEqual(
      expect.arrayContaining([
        'match_slug',
        'revision',
        'status',
        'source',
        'submitted_by_uid',
        'submitted_by_team',
        'result',
        'confirmation',
        'confirm_deadline',
        'timeout_action',
        'confirmed_by_uid',
        'disputed_by_uid',
        'dispute_reason',
        'resolved_by_uid',
      ])
    );
    for (const uid of [
      'submitted_by_uid',
      'confirmed_by_uid',
      'disputed_by_uid',
      'resolved_by_uid',
    ]) {
      expect(tables.match_reports.columns.find((c) => c.name === uid)?.type).toBe('uuid');
    }

    expect(columnNames(tables.match_report_actions)).toEqual(
      expect.arrayContaining(['report_id', 'match_slug', 'action', 'actor_uid', 'actor_role'])
    );
    expect(columnNames(tables.custom_stat_fields)).toEqual(
      expect.arrayContaining(['tournament_id', 'key', 'label', 'value_type', 'scope'])
    );
    expect(columnNames(tables.match_stat_values)).toEqual(
      expect.arrayContaining([
        'match_slug',
        'map_number',
        'field_id',
        'player_uid',
        'team',
        'value_number',
        'value_text',
        'report_id',
      ])
    );
  });

  test('the indexes and foreign keys are the ones the flow depends on', async ({ request }) => {
    const tables = await schema(request);

    const open = tables.match_reports.indexes.find((i) => i.name === 'idx_match_reports_open');
    expect(open, 'the one-open-report-per-match index is missing').toBeTruthy();
    expect(open!.definition).toContain('UNIQUE');
    expect(open!.definition).toContain('submitted');
    expect(open!.definition).toContain('disputed');

    const statPlayer = tables.match_stat_values.indexes.find(
      (i) => i.name === 'idx_match_stat_values_player'
    );
    const statTeam = tables.match_stat_values.indexes.find(
      (i) => i.name === 'idx_match_stat_values_team'
    );
    expect(statPlayer?.definition).toContain('UNIQUE');
    expect(statPlayer?.definition).toContain('player_uid IS NOT NULL');
    expect(statTeam?.definition).toContain('UNIQUE');
    expect(statTeam?.definition).toContain('player_uid IS NULL');

    // A report and its audit trail go when the match does.
    const reportFks = tables.match_reports.foreignKeys.map((f) => f.definition).join(' ');
    expect(reportFks).toContain('matches(slug) ON DELETE CASCADE');
    const actionFks = tables.match_report_actions.foreignKeys.map((f) => f.definition).join(' ');
    expect(actionFks).toContain('match_reports(id) ON DELETE CASCADE');

    // Membership follows the team and the account.
    const memberFks = tables.team_members.foreignKeys.map((f) => f.definition).join(' ');
    expect(memberFks).toContain('teams(id) ON DELETE CASCADE');
    expect(memberFks).toContain('players(uid) ON DELETE CASCADE');
    const statFks = tables.match_stat_values.foreignKeys.map((f) => f.definition).join(' ');
    expect(statFks).toContain('players(uid) ON DELETE CASCADE');
    expect(statFks).toContain('custom_stat_fields(id) ON DELETE CASCADE');

    // Who reported what survives an account being deleted: no foreign key on
    // the actor columns, by design.
    expect(reportFks).not.toContain('submitted_by_uid');
  });

  test('the backfill migration is recorded once and does not run again', async ({ request }) => {
    const before = await request.get('/api/test/schema-migrations');
    expect(before.ok()).toBe(true);
    const applied = (await before.json()).applied as string[];
    expect(applied.filter((id) => id === MIGRATION_ID)).toHaveLength(1);

    const rerun = await request.post('/api/test/schema-migrations/run');
    expect(rerun.ok()).toBe(true);
    expect((await rerun.json()).applied).toEqual([]);
  });

  test('a team written through the API mirrors its roster as members', async ({ request }) => {
    const teamId = `test-team-members-${Date.now()}`;
    const roster = [steamId(), steamId(), steamId()];
    await createTeamWithRoster(request, teamId, roster);

    const rows = await members(request, teamId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.playerId).sort()).toEqual([...roster].sort());
    // 2.x has no captain or owner column, so the mirror makes members only.
    expect(rows.every((r) => r.role === 'member')).toBe(true);
  });

  test('a roster edit follows, and a captain stays a captain', async ({ request }) => {
    const teamId = `test-team-roster-${Date.now()}`;
    const [keep, leaves] = [steamId(), steamId()];
    await createTeamWithRoster(request, teamId, [keep, leaves]);

    const before = await members(request, teamId);
    const captain = before.find((r) => r.playerId === keep);
    expect(captain).toBeTruthy();
    const promote = await request.post('/api/test/team-members', {
      data: { teamId, accountUid: captain!.accountUid, role: 'captain' },
    });
    expect(promote.ok(), await promote.text()).toBe(true);

    const joins = steamId();
    await setRoster(request, teamId, [keep, joins]);

    const after = await members(request, teamId);
    expect(after.map((r) => r.playerId).sort()).toEqual([keep, joins].sort());
    expect(after.find((r) => r.playerId === keep)?.role).toBe('captain');
    expect(after.find((r) => r.playerId === joins)?.role).toBe('member');
  });

  test('the backfill restores cleared rows and a second run inserts nothing', async ({
    request,
  }) => {
    const teamId = `test-team-backfill-${Date.now()}`;
    const roster = [steamId(), steamId()];
    await createTeamWithRoster(request, teamId, roster);

    const first = await backfill(request, teamId);
    expect(first.members).toBeGreaterThanOrEqual(2);
    const restored = await members(request, teamId);
    expect(restored.map((r) => r.playerId).sort()).toEqual([...roster].sort());
    expect(restored.every((r) => r.role === 'member')).toBe(true);

    const second = await backfill(request);
    expect(second.members).toBe(0);
    const unchanged = await members(request, teamId);
    expect(unchanged).toEqual(restored);
  });

  test('deleting a team takes its memberships with it', async ({ request }) => {
    const teamId = `test-team-delete-${Date.now()}`;
    await createTeamWithRoster(request, teamId, [steamId()]);
    expect(await members(request, teamId)).toHaveLength(1);

    const res = await request.delete(`/api/teams/${teamId}`);
    expect(res.ok(), await res.text()).toBe(true);
    expect(await members(request, teamId)).toHaveLength(0);
  });

  test('one report per match is open, and revisions do not repeat', async ({ request }) => {
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      teamCount: 2,
      serverCount: 1,
      prefix: 'report-schema',
    });
    expect(setup, 'tournament setup failed').toBeTruthy();

    const list = await request.get('/api/matches');
    expect(list.ok(), await list.text()).toBe(true);
    const matches = (await list.json()).matches as Array<{ slug: string }>;
    expect(matches.length).toBeGreaterThan(0);
    const slug = matches[0].slug;

    const submit = async (body: Record<string, unknown>) =>
      request.post('/api/test/match-reports', { data: { matchSlug: slug, ...body } });

    const first = await submit({ revision: 1, status: 'submitted' });
    expect(first.status(), await first.text()).toBe(201);

    // A second open report for the same match is refused.
    const secondOpen = await submit({ revision: 2, status: 'submitted' });
    expect(secondOpen.status()).toBe(409);

    // One that is not open is fine.
    const closed = await submit({ revision: 2, status: 'confirmed' });
    expect(closed.status(), await closed.text()).toBe(201);

    // The revision may not repeat within the match.
    const repeated = await submit({ revision: 2, status: 'confirmed' });
    expect(repeated.status()).toBe(409);

    const reports = await request.get(`/api/test/match-reports?matchSlug=${slug}`);
    expect(reports.ok()).toBe(true);
    expect((await reports.json()).reports).toHaveLength(2);

    // A report needs a match that exists.
    const orphan = await request.post('/api/test/match-reports', {
      data: { matchSlug: `no-such-match-${Date.now()}` },
    });
    expect(orphan.status()).toBe(409);
  });
});
