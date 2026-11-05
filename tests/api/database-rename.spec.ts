import { test, expect } from '@playwright/test';
import {
  DATABASE_NAME,
  LEGACY_DATABASE_NAME,
  databaseNameOf,
  platformConnectionString,
  renameLegacyDatabase,
  withDatabase,
} from '../../api/src/config/databaseRename';

/**
 * The 2.x → 3.0 database rename (api/src/config/databaseRename.ts).
 *
 * The rename itself needs a Postgres cluster the test can create databases in,
 * so the upgrade test (scripts/test-upgrade.ts) covers it end to end: a real
 * 2.4.15 database renamed with its data, and each state it must refuse. These
 * are the parts that decide what it acts on, which need no database.
 *
 * @tag api
 */
test.describe('Database rename: what it acts on', () => {
  test('reads the database a connection string names', () => {
    expect(databaseNameOf('postgresql://u:p@db:5432/auto_tournament')).toBe('auto_tournament');
    expect(databaseNameOf('postgresql://u:p@db:5432/auto_tournament?sslmode=require')).toBe(
      'auto_tournament'
    );
    expect(databaseNameOf('postgresql://u:p@db:5432/my%20db')).toBe('my db');
    expect(databaseNameOf('postgresql://u:p@db:5432')).toBeNull();
    expect(databaseNameOf('not a url')).toBeNull();
  });

  test('points a connection string at another database, keeping everything else', () => {
    expect(
      withDatabase('postgresql://u:p%40ss@db:5432/auto_tournament?sslmode=require', 'postgres')
    ).toBe('postgresql://u:p%40ss@db:5432/postgres?sslmode=require');
  });

  test('configured with the 2.x name, the platform uses the 3.0 name (and renames it)', async () => {
    expect(platformConnectionString(`postgresql://u:p@db:5432/${LEGACY_DATABASE_NAME}?ssl=1`)).toBe(
      `postgresql://u:p@db:5432/${DATABASE_NAME}?ssl=1`
    );
    expect(platformConnectionString('postgresql://u:p@db:5432/my_tournaments')).toBe(
      'postgresql://u:p@db:5432/my_tournaments'
    );
    // It goes on to the rename: port 1 answers nothing, so it fails reaching Postgres.
    const url = `postgresql://postgres:postgres@127.0.0.1:1/${LEGACY_DATABASE_NAME}`;
    await expect(
      renameLegacyDatabase(url, { connectionTimeoutMillis: 2000 })
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  test('a custom database name is left alone, without connecting', async () => {
    const url = 'postgresql://postgres:postgres@127.0.0.1:1/my_tournaments';
    await expect(renameLegacyDatabase(url)).resolves.toBe('not-applicable');
  });

  test('an unreachable Postgres is reported as such, not as a rename problem', async () => {
    const url = `postgresql://postgres:postgres@127.0.0.1:1/${DATABASE_NAME}`;
    await expect(
      renameLegacyDatabase(url, { connectionTimeoutMillis: 2000 })
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});
