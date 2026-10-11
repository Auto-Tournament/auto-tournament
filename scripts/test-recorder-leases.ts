/** PostgreSQL regression proof. Run with a dedicated RECORDER_TEST_DATABASE_URL. */
import assert from 'node:assert/strict';
import { Pool } from 'pg';

async function main() {
  const url = process.env.RECORDER_TEST_DATABASE_URL;
  if (!url) throw new Error('Supply a dedicated RECORDER_TEST_DATABASE_URL');
  const admin = new Pool({ connectionString: url });
  const schema = `recorder_test_${process.pid}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = scoped.toString();
  const { db } = await import('../api/src/config/database');
  const lease = await import('../api/src/integrations/cs2/demos/recorderLeases');
  try {
    await db.runAsync(
      'CREATE TABLE cs2_recorder_claims (recorder TEXT PRIMARY KEY, token TEXT UNIQUE, started_at INTEGER, heartbeat_at INTEGER)'
    );
    for (const table of lease.RECORDING_TABLES) {
      await db.runAsync(
        `CREATE TABLE ${table} (id SERIAL PRIMARY KEY, status TEXT, attempts INTEGER, recorder TEXT, claimed_at INTEGER, claim_started_at INTEGER, retry_until INTEGER, avoid_recorder TEXT, error TEXT)`
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const put = async (table: string, attempts: number, start = now - 800, beat = now - 800) => {
      const row = await db.queryOneAsync<{ id: number }>(
        `INSERT INTO ${table} (status, attempts, recorder, claimed_at, claim_started_at) VALUES ('recording', ?, 'csrender5', ?, ?) RETURNING id`,
        [attempts, beat, start]
      );
      return Number(row!.id);
    };
    const id = await put('cs2_highlights', 1);
    assert.deepEqual(await lease.recoverRecordingLeases(), []);
    const first = await db.queryOneAsync<{ status: string; retry_until: number; attempts: number }>(
      'SELECT * FROM cs2_highlights WHERE id = ?',
      [id]
    );
    assert.equal(first!.status, 'pending');
    assert.equal(first!.attempts, 1);
    assert.ok(first!.retry_until > now);
    assert.equal(
      (
        await db.queryAsync(`SELECT id FROM cs2_highlights WHERE ${lease.recordingWaiting()}`, [
          'csrender2',
        ])
      ).length,
      0
    );
    assert.equal(
      (
        await db.queryAsync(`SELECT id FROM cs2_highlights WHERE ${lease.recordingWaiting()}`, [
          'csrender5',
        ])
      ).length,
      1
    );
    await db.runAsync('UPDATE cs2_highlights SET retry_until = ? WHERE id = ?', [now - 1, id]);
    assert.equal(
      (
        await db.queryAsync(`SELECT id FROM cs2_highlights WHERE ${lease.recordingWaiting()}`, [
          'csrender2',
        ])
      ).length,
      1
    );
    await db.runAsync(
      "UPDATE cs2_highlights SET status = 'recording', attempts = 2, claimed_at = ? WHERE id = ?",
      [now - 800, id]
    );
    await lease.recoverRecordingLeases();
    const second = await db.queryOneAsync<{ avoid_recorder: string; retry_until: number | null }>(
      'SELECT * FROM cs2_highlights WHERE id = ?',
      [id]
    );
    assert.equal(second!.avoid_recorder, 'csrender5');
    assert.equal(second!.retry_until, null);
    await db.runAsync(
      "UPDATE cs2_highlights SET status = 'recording', attempts = 3, claimed_at = ? WHERE id = ?",
      [now - 800, id]
    );
    assert.deepEqual(await lease.recoverRecordingLeases(), [id]);
    assert.equal(
      (
        await db.queryAsync(`SELECT id FROM cs2_highlights WHERE ${lease.recordingWaiting()}`, [
          'csrender2',
        ])
      ).length,
      0
    );
    const exhaustedPending = await put('cs2_highlights', 3, now, now);
    await db.runAsync("UPDATE cs2_highlights SET status = 'pending' WHERE id = ?", [
      exhaustedPending,
    ]);
    assert.deepEqual(
      await lease.recoverRecordingLeases(),
      [exhaustedPending],
      'exhausted legacy pending work cannot remain stuck'
    );
    for (const table of lease.RECORDING_TABLES) await put(table, 1, now, now - 300);
    assert.equal(await lease.renewRecordingLeases('csrender5'), 4);
    assert.equal(await lease.recorderHasActiveClaim('csrender5'), true);
    await db.runAsync('UPDATE cs2_team_reels SET claim_started_at = ?', [
      now - lease.RECORDER_JOB_SECONDS - 1,
    ]);
    assert.equal(await lease.renewRecordingLeases('csrender5'), 3);
    await lease.recoverRecordingLeases();
    assert.equal(
      (await db.queryOneAsync<{ status: string }>('SELECT status FROM cs2_team_reels'))!.status,
      'pending'
    );
    for (const table of lease.RECORDING_TABLES) await db.runAsync(`DELETE FROM ${table}`);
    assert.equal(await lease.recorderHasActiveClaim('csrender5'), false);
    for (let attempts = 1; attempts <= 3; attempts++) {
      const failId = await put('cs2_highlights', attempts, now, now);
      await db.runAsync(`UPDATE cs2_highlights SET ${lease.recordingFailureSql} WHERE id = ?`, [
        'test fault',
        failId,
      ]);
      const row = await db.queryOneAsync<{ status: string; avoid_recorder: string | null }>(
        'SELECT * FROM cs2_highlights WHERE id = ?',
        [failId]
      );
      assert.equal(row!.status, attempts === 3 ? 'failed' : 'pending');
      assert.equal(row!.avoid_recorder, attempts >= 2 ? 'csrender5' : null);
    }

    await db.runAsync(
      `CREATE TABLE cs2_recorders (name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, group_id INTEGER, paused_until INTEGER, last_seen INTEGER, update_status TEXT DEFAULT 'current', update_error TEXT, update_agent_seen INTEGER, recorder_image TEXT, latest_image TEXT, update_target TEXT)`
    );
    await db.runAsync(
      'CREATE TABLE cs2_recorder_groups (id INTEGER PRIMARY KEY, enabled INTEGER DEFAULT 1)'
    );
    await db.runAsync(
      'CREATE TABLE cs2_recording_targets (match_slug TEXT PRIMARY KEY, group_id INTEGER)'
    );
    await db.runAsync('ALTER TABLE cs2_highlights ADD COLUMN match_slug TEXT');
    await db.runAsync('INSERT INTO cs2_recorder_groups (id) VALUES (1), (2)');
    await db.runAsync(
      "INSERT INTO cs2_recorders (name, group_id, last_seen) VALUES ('csrender5', 1, ?), ('csrender2', 1, ?), ('vm', 2, ?)",
      [now, now, now]
    );
    await db.runAsync("INSERT INTO cs2_recording_targets VALUES ('test-match', 1)");
    await db.runAsync('DELETE FROM cs2_highlights');
    await db.runAsync(
      "INSERT INTO cs2_highlights (status, attempts, recorder, avoid_recorder, match_slug) VALUES ('pending', 2, 'csrender5', 'csrender5', 'test-match')"
    );
    const { reelFailoverFilter } = await import('../api/src/integrations/cs2/demos/reelFailover');
    const filter = await reelFailoverFilter('csrender5', 'h.match_slug');
    const eligible = () =>
      db.queryAsync(`SELECT id FROM cs2_highlights h WHERE ${filter.sql}`, filter.params);
    assert.equal((await eligible()).length, 0, 'a healthy same-group peer gets the handoff');
    await db.runAsync("UPDATE cs2_recorders SET enabled = 0 WHERE name = 'csrender2'");
    assert.equal(
      (await eligible()).length,
      1,
      'an unrelated VM cannot block the lone eligible worker'
    );
    await db.runAsync(
      "UPDATE cs2_recorders SET enabled = 1, update_status = 'queued' WHERE name = 'csrender2'"
    );
    assert.equal(
      (await eligible()).length,
      1,
      'a draining updater is not an eligible failover peer'
    );

    const claim = await lease.registerRecorderClaim('csrender5');
    assert.equal(await lease.validRecorderClaim('csrender5', claim), true);
    await db.runAsync('UPDATE cs2_recorder_claims SET heartbeat_at = ?', [now - 800]);
    assert.equal(await lease.validRecorderClaim('csrender5', claim), false);
    await lease.recoverRecordingLeases();
    const replacement = await lease.registerRecorderClaim('csrender5');
    assert.notEqual(replacement, claim);
    assert.equal(
      await lease.validRecorderClaim('csrender5', claim),
      false,
      'old attempt cannot write after the same recorder reclaims work'
    );
    await db.runAsync('DELETE FROM cs2_recorder_claims');
    const originalFetch = globalThis.fetch;
    let requests = 0;
    const oldImage = 'sivertio/auto-tournament-recorder@sha256:' + 'a'.repeat(64);
    const nextImage = 'sivertio/auto-tournament-recorder@sha256:' + 'b'.repeat(64);
    globalThis.fetch = async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'test-registry-token' }),
        headers: { get: () => 'sha256:' + 'b'.repeat(64) },
      } as unknown as Awaited<ReturnType<typeof originalFetch>>;
    };
    try {
      await db.runAsync(
        "UPDATE cs2_recorders SET update_status = 'current', recorder_image = ?, update_agent_seen = ?",
        [oldImage, now]
      );
      await db.runAsync("UPDATE cs2_recorders SET update_agent_seen = 0 WHERE name = 'vm'");
      const { refreshRecorderRelease } =
        await import('../api/src/integrations/cs2/demos/recorderUpdates');
      await Promise.all(Array.from({ length: 20 }, () => refreshRecorderRelease()));
      assert.equal(requests, 2, '20 callers share one registry token/manifest check');
      const { requestRecorderUpdate } =
        await import('../api/src/integrations/cs2/demos/recorderFleet');
      assert.equal(await requestRecorderUpdate(), 2);
      assert.equal(await requestRecorderUpdate(), 0, 'repeat Update all queues no duplicate jobs');
      assert.equal(
        await requestRecorderUpdate('csrender5'),
        0,
        'repeat individual request is idempotent'
      );
      assert.equal(requests, 2, 'queueing uses cached central release metadata');
      const targets = await db.queryAsync<{ update_target: string }>(
        "SELECT update_target FROM cs2_recorders WHERE update_status = 'queued'"
      );
      assert.ok(
        targets.every((row) => row.update_target === nextImage),
        'queued requests pin the checked digest'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    await db.runAsync(
      'CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)'
    );
    await db.runAsync('ALTER TABLE cs2_highlights ADD COLUMN map_number INTEGER');
    await db.runAsync('ALTER TABLE cs2_match_reels ADD COLUMN match_slug TEXT');
    await db.runAsync('ALTER TABLE cs2_match_reels ADD COLUMN map_number INTEGER');
    await db.runAsync('DELETE FROM cs2_highlights');
    await db.runAsync('DELETE FROM cs2_match_reels');
    await db.runAsync(
      "INSERT INTO cs2_highlights (status, attempts, recorder, match_slug, map_number, retry_until, avoid_recorder) VALUES ('done', 3, 'vm', 'test-match', 0, ?, 'vm'), ('recording', 1, 'csrender2', 'test-match', 0, NULL, NULL), ('done', 1, 'vm', 'other-match', 0, NULL, NULL)",
      [now + 90]
    );
    const { SERIES_REEL } = await import('../api/src/integrations/cs2/demos/highlights');
    await db.runAsync(
      "INSERT INTO cs2_match_reels (status, attempts, recorder, match_slug, map_number) VALUES ('done', 3, 'vm', 'test-match', 0), ('done', 3, 'vm', 'test-match', ?)",
      [SERIES_REEL]
    );
    const { redo } = await import('../api/src/integrations/cs2/demos/clipsAdmin');
    assert.deepEqual(await redo({ matchSlugs: ['test-match'] }), { clips: 1, reels: 2 });
    const reset = await db.queryOneAsync<{
      attempts: number;
      retry_until: number | null;
      avoid_recorder: string | null;
      recorder: string | null;
    }>("SELECT * FROM cs2_highlights WHERE match_slug = 'test-match' AND status = 'pending'");
    assert.equal(reset!.attempts, 0);
    assert.equal(reset!.retry_until, null);
    assert.equal(reset!.avoid_recorder, null);
    assert.equal(reset!.recorder, null);
    assert.equal(
      (
        await db.queryAsync(
          "SELECT id FROM cs2_highlights WHERE match_slug = 'test-match' AND status = 'recording'"
        )
      ).length,
      1,
      'redo leaves current recordings alone'
    );
    assert.equal(
      (
        await db.queryAsync(
          "SELECT id FROM cs2_highlights WHERE match_slug = 'other-match' AND status = 'done'"
        )
      ).length,
      1,
      'redo leaves other matches alone'
    );
    assert.equal(
      (await db.queryAsync("SELECT id FROM cs2_match_reels WHERE status = 'waiting'")).length,
      2,
      'map and series reels wait for replacement clips'
    );
    console.log(
      'Recorder lease regression checks passed: retry reservation, handoff, exhaustion, all reel heartbeats, hard deadline, active-claim guard, group-aware handoff and central idempotent updates.'
    );
  } finally {
    db.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
