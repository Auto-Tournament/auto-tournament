import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Backends dropped by Postgres (restart, admin kill, proxy idle timeout) must not
 * take the API down: the pool discards them and reconnects.
 *
 * @tag api
 */
test(
  'API survives its Postgres backends being terminated',
  { tag: ['@api'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const db = process.env.DB_NAME ?? 'auto_tournament';
    const admin = new Client({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: db,
    });
    await admin.connect();
    try {
      // Warm several pooled connections so idle clients exist.
      await Promise.all(
        Array.from({ length: 6 }, () => request.get('/api/teams', { headers: getAuthHeader() }))
      );
      const killed = await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [db]
      );
      expect(killed.rowCount).toBeGreaterThan(0);

      await expect(async () => {
        expect((await request.get('/health')).status()).toBe(200);
        const res = await request.get('/api/teams', { headers: getAuthHeader() });
        expect(res.status()).toBe(200);
      }).toPass({ timeout: 15_000 });
    } finally {
      await admin.end();
    }
  }
);

test(
  'API survives its Postgres backend being terminated while a transaction holds it',
  { tag: ['@api'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const db = process.env.DB_NAME ?? 'auto_tournament';
    const admin = new Client({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: db,
    });
    await admin.connect();
    try {
      const held = request.post('/api/test/db-hold', {
        headers: getAuthHeader(),
        data: { seconds: 10 },
      });
      await expect
        .poll(async () => {
          const killed = await admin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
             WHERE datname = $1 AND state = 'idle in transaction'`,
            [db]
          );
          return killed.rowCount;
        })
        .toBeGreaterThan(0);
      expect((await held).status()).toBe(500);

      await expect(async () => {
        expect((await request.get('/health')).status()).toBe(200);
        const res = await request.get('/api/teams', { headers: getAuthHeader() });
        expect(res.status()).toBe(200);
      }).toPass({ timeout: 15_000 });
    } finally {
      await admin.end();
    }
  }
);
