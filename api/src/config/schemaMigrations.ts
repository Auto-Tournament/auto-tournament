/**
 * Hand-written migrations, recorded in `schema_migrations` so each one runs
 * once per database.
 *
 * Column additions do not belong here: the auto-migrator in database.ts
 * (`getSchemaColumns`) adds every declared column by itself. This is for the
 * steps it cannot derive from the schema: backfills and data rewrites.
 *
 * Rules for a migration:
 * - Its id never changes once released. Add a new migration instead of
 *   editing one that has shipped.
 * - Its body is idempotent on its own (`ON CONFLICT DO NOTHING`, `IF NOT
 *   EXISTS`, ...). The ledger row is written in the same transaction, so a
 *   crash cannot record a half-applied migration, but a body that is safe to
 *   run twice keeps a restored or hand-edited database safe as well.
 * - It works on a fresh database (every table empty) and on one upgraded
 *   from 2.4.
 */

import type { PoolClient } from 'pg';
import { log } from '../utils/logger';

/** What a migration body gets: a client inside the migration's transaction. */
type Queryable = Pick<PoolClient, 'query'>;

export interface SchemaMigration {
  id: string;
  description: string;
  up(client: Queryable): Promise<void>;
}

export interface LinkedAccountsBackfillResult {
  steam: number;
  discord: number;
}

/**
 * Copy the accounts the database already knows into `linked_accounts`:
 * - one `('steam', players.id)` row per player, unverified: an admin can
 *   create or import a player by Steam ID without that person ever signing in;
 * - one verified `('discord', provider_user_id)` row per Discord sign-in in
 *   `auth_identities`, owned by the account the identity belongs to.
 *
 * `players.discord_id` is not copied: it is contact data an admin typed in,
 * unverified and not unique. Other sign-in providers (GitHub, Google,
 * Keycloak) are login methods, not game accounts, and stay out too.
 *
 * Only missing rows are inserted (`ON CONFLICT DO NOTHING`), so existing rows
 * keep their ids and running it again changes nothing. Returns how many rows
 * each part inserted.
 */
export async function backfillLinkedAccounts(
  client: Queryable
): Promise<LinkedAccountsBackfillResult> {
  const steam = await client.query(
    `INSERT INTO linked_accounts (player_id, provider, external_id, verified, created_at)
     SELECT p.id, 'steam', p.id, FALSE, p.created_at
       FROM players p
      ORDER BY p.created_at, p.id
     ON CONFLICT (provider, external_id) DO NOTHING`
  );
  const discord = await client.query(
    `INSERT INTO linked_accounts (player_id, provider, external_id, verified, created_at)
     SELECT ai.steam_id, 'discord', ai.provider_user_id, TRUE, ai.created_at
       FROM auth_identities ai
      WHERE ai.provider = 'discord'
      ORDER BY ai.id
     ON CONFLICT (provider, external_id) DO NOTHING`
  );
  return { steam: steam.rowCount ?? 0, discord: discord.rowCount ?? 0 };
}

export interface TeamMembersBackfillResult {
  /** Memberships inserted. */
  members: number;
  /** Teams that contributed at least one membership. */
  teams: number;
  /** Roster entries with no `players` row, so no `players.uid` to key on. */
  skipped: number;
}

/** One roster entry of `teams.players`, which is a JSON array. */
interface RosterEntry {
  steamId?: unknown;
}

/**
 * Fill `team_members` from the rosters the database already holds.
 *
 * There is no captain or owner column anywhere in 2.x: `teams` has id, name,
 * tag, `discord_role_id` and the roster JSON, and only admins may edit a team.
 * So every existing roster player becomes a **member** and the backfill
 * creates no captains; an admin (phase D2 onwards) promotes one.
 *
 * A roster player with no `players` row is skipped: the table keys on
 * `players.uid`. In practice there is none - `teamService` creates the player
 * rows on every team write - but an imported or hand-edited database may have
 * one, and it must not stop the migration.
 *
 * Only missing rows are inserted (`ON CONFLICT DO NOTHING`), so a row that
 * already exists keeps its id and its role, and running this again changes
 * nothing.
 */
export async function backfillTeamMembers(client: Queryable): Promise<TeamMembersBackfillResult> {
  const { rows: teams } = await client.query<{ id: string; players: string; created_at: number }>(
    'SELECT id, players, created_at FROM teams ORDER BY created_at, id'
  );

  const result: TeamMembersBackfillResult = { members: 0, teams: 0, skipped: 0 };

  for (const team of teams) {
    let roster: RosterEntry[];
    try {
      const parsed: unknown = JSON.parse(team.players ?? '[]');
      roster = Array.isArray(parsed) ? (parsed as RosterEntry[]) : [];
    } catch {
      // A roster we cannot read is not a reason to fail the migration, and
      // retrying it on every start would never make it parse.
      log.warn(`[PostgreSQL] Team ${team.id} has a roster that is not JSON, skipped`);
      continue;
    }

    const steamIds = [
      ...new Set(
        roster
          .map((entry) => entry?.steamId)
          .filter((id): id is string => typeof id === 'string' && id !== '')
      ),
    ];
    if (steamIds.length === 0) continue;

    const inserted = await client.query(
      `INSERT INTO team_members (team_id, account_uid, role, created_at, updated_at)
       SELECT $1, p.uid, 'member', $2, $2
         FROM players p
        WHERE p.id = ANY($3::text[])
        ORDER BY p.id
       ON CONFLICT (team_id, account_uid) DO NOTHING`,
      [team.id, team.created_at, steamIds]
    );
    const { rows: known } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM players WHERE id = ANY($1::text[])',
      [steamIds]
    );

    result.members += inserted.rowCount ?? 0;
    result.skipped += steamIds.length - Number(known[0]?.count ?? 0);
    if ((inserted.rowCount ?? 0) > 0) result.teams += 1;
  }

  return result;
}

/** In the order they run. Append only. */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    id: '2026-09-22-linked-accounts-backfill',
    description: 'Backfill linked_accounts from players (steam) and auth_identities (discord)',
    async up(client) {
      const { steam, discord } = await backfillLinkedAccounts(client);
      log.success(
        `[PostgreSQL] Backfilled linked_accounts: ${steam} Steam, ${discord} Discord account(s)`
      );
    },
  },
  {
    id: '2026-09-22-team-members-backfill',
    description: 'Backfill team_members from the teams.players rosters (no captains exist yet)',
    async up(client) {
      const { members, teams, skipped } = await backfillTeamMembers(client);
      log.success(
        `[PostgreSQL] Backfilled team_members: ${members} membership(s) across ${teams} team(s)` +
          (skipped > 0
            ? `, ${skipped} roster entr${skipped === 1 ? 'y' : 'ies'} without a player row skipped`
            : '')
      );
    },
  },
];

/** A fixed key for the advisory lock, so two API processes never run one migration twice. */
const MIGRATION_LOCK_KEY = 7_319_460_013;

/**
 * Run every migration that has no `schema_migrations` row yet. Each runs in its
 * own transaction together with its ledger row. A failure rolls that
 * migration back, is logged, and stops the later ones (they may depend on
 * it); the next start tries again.
 *
 * Returns the ids applied by this call.
 */
export async function runSchemaMigrations(
  client: PoolClient,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS
): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of migrations) {
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [
        migration.id,
      ]);
      if (done.rowCount && done.rowCount > 0) {
        await client.query('COMMIT');
        continue;
      }
      await migration.up(client);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
      applied.push(migration.id);
      log.success(`[PostgreSQL] Applied migration ${migration.id}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      log.error(
        `[PostgreSQL] Migration ${migration.id} failed, will retry on the next start: ${
          (err as Error).message
        }`
      );
      break;
    }
  }
  return applied;
}
