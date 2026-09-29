/**
 * `reset-admin`: recovery when no admin can sign in.
 *
 *   docker exec auto-tournament reset-admin
 *   yarn reset-admin            (from a source checkout)
 *
 * Prints a one-time code valid for 1 hour. On /setup it lets you set a new
 * password for an existing local admin (its TOTP is removed) or create a new
 * local admin, and it turns "Allow local admin login" back on. Only the
 * code's hash is stored. Running it again replaces an unused code.
 *
 * Talks to the database directly with the container's own settings
 * (DATABASE_URL or DB_*); the server must have started once so the tables
 * exist.
 */
import { db } from '../config/database';
import { localAdminService } from '../services/localAdminService';

async function main(): Promise<void> {
  const { code, expiresAt } = await localAdminService.createCode('reset');
  const admins = await db.queryAsync<{ username: string }>('SELECT username FROM local_admins ORDER BY username', []);
  const base = (process.env.FRONTEND_BASE_URL?.trim() || `http://localhost:${process.env.PORT || '3069'}`).replace(/\/+$/, '');
  const lines = [
    '',
    'Auto Tournament admin reset',
    '',
    `  Open ${base}/setup and enter this code: ${code}`,
    `  It works once and expires at ${new Date(expiresAt * 1000).toISOString()} (1 hour).`,
    '',
    admins.length > 0
      ? `  Local admin accounts: ${admins.map((a) => a.username).join(', ')}. Enter one of these usernames to set a new password, or a new username to create another admin.`
      : '  There is no local admin account yet: choose a username to create one.',
    '  Using the code also turns "Allow local admin login" back on.',
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(
      `reset-admin failed: ${(error as Error).message}\n` +
        'Is the database reachable, and has the server started at least once?\n'
    );
    process.exit(1);
  });
