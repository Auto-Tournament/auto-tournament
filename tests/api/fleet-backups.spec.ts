import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  MAX_INLINE_DATA_CHARS,
  RoundBackupStore,
  backupRetentionDays,
  createMemoryRoundBackupPersistence,
  handleBackupEvent,
} from '../../api/src/integrations/cs2/fleet/backups';
import {
  RestoreError,
  createMemoryRestoreAudit,
  restoreRoundBackup,
  settleRestoreFromCommand,
  type RestoreDeps,
} from '../../api/src/integrations/cs2/fleet/restore';
import type { FleetCommandRecord } from '../../api/src/integrations/cs2/fleet/commands';
import type { LiveMatchRecord } from '../../api/src/integrations/cs2/fleet/state';
import {
  validatePayload,
  type CmdPayload,
  type Envelope,
  type InlineBackup,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The round backup store (fleet/backups.ts) and "restore to round N"
 * (fleet/restore.ts) without a database: checking and storing Ready Up's
 * inline backups (sha256, size, parts), idempotency and replacement,
 * superseded rounds, retention, and the restore command with the backup
 * inline, for both transports.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

const SLUG = 'bk-match';
const DAY = 86400;

function backupOf(content: Buffer | string, over: Partial<InlineBackup> = {}): InlineBackup {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    map_number: 1,
    round: 5,
    file: 'readyup_backup_1_map1__round04.txt',
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    score: { team1: 3, team2: 1 },
    encoding: 'base64',
    data: buf.toString('base64'),
    ...over,
  };
}

function newStore(ended: (slug: string) => number | null | undefined = () => null) {
  const persistence = createMemoryRoundBackupPersistence(ended);
  return { store: new RoundBackupStore(persistence), persistence };
}

test.describe('Round backup store', () => {
  test("Ready Up's own event.backup frame is checked and stored", async () => {
    const { store } = newStore();
    const frame = example('live.event.backup.json');
    const payload = frame.payload as { match_id: string; data: InlineBackup };
    const outcome = await store.ingest({
      matchSlug: payload.match_id,
      serverId: 'srv_a',
      epoch: frame.epoch ?? null,
      backup: payload.data,
    });
    expect(outcome.kind).toBe('stored');
    const listed = await store.list(payload.match_id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      mapNumber: 1,
      round: 1,
      size: payload.data.size,
      sha256: payload.data.sha256,
      serverId: 'srv_a',
      epoch: 2,
      supersededAt: null,
    });
    expect(listed[0]).not.toHaveProperty('data');
    const full = await store.get(payload.match_id, 1, 1);
    expect(full?.data).toBe(payload.data.data);
  });

  test('idempotent: the same file again is a duplicate, other content replaces it', async () => {
    const { store, persistence } = newStore();
    const first = backupOf('round five, first time');
    expect((await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: first }, 100)).kind).toBe('stored');
    const again = await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: first }, 200);
    expect(again.kind).toBe('duplicate');
    expect(persistence.rows).toHaveLength(1);
    expect(persistence.rows[0].updatedAt).toBe(100);

    // Round 5 replayed after a restore, with other content: the newest wins.
    const replayed = backupOf('round five, replayed', { score: { team1: 3, team2: 2 } });
    const outcome = await store.ingest({ matchSlug: SLUG, serverId: 's2', epoch: 2, backup: replayed }, 300);
    expect(outcome).toMatchObject({ kind: 'replaced', previousSha256: first.sha256 });
    expect(persistence.rows).toHaveLength(1);
    expect(persistence.rows[0]).toMatchObject({
      sha256: replayed.sha256,
      serverId: 's2',
      epoch: 2,
      score: { team1: 3, team2: 2 },
      storedAt: 100,
      updatedAt: 300,
    });
  });

  test('forget: a fresh start drops every backup and staged part of that slug, and only that slug', async () => {
    const { store, persistence } = newStore();
    await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: backupOf('old r5', { round: 5 }) });
    await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: backupOf('old r11', { round: 11 }) });
    await store.ingest({ matchSlug: 'other', serverId: 's1', epoch: 1, backup: backupOf('other r2', { round: 2 }) });
    const half = Buffer.from('half of a file');
    await store.ingest({
      matchSlug: SLUG,
      serverId: 's1',
      epoch: 1,
      backup: backupOf('half of a file', { round: 6, part: 1, parts: 2, data: half.subarray(0, 4).toString('base64') }),
    });
    expect(persistence.partCount()).toBe(1);
    expect(await store.forget(SLUG)).toBe(2);
    expect(await store.list(SLUG)).toEqual([]);
    expect(persistence.partCount()).toBe(0);
    expect(await store.list('other')).toHaveLength(1);
  });

  test('bad files are refused: sha256, size, base64, encoding, limits', async () => {
    const { store, persistence } = newStore();
    const good = backupOf('abc');
    const cases: Array<[Partial<InlineBackup>, RegExp]> = [
      [{ sha256: 'f'.repeat(64) }, /sha256/],
      [{ size: 4 }, /size mismatch/],
      [{ data: 'not base64!' }, /base64/],
      [{ encoding: 'hex' as 'base64' }, /encoding/],
      [{ size: 5 * 1024 * 1024 }, /outside/],
      [{ part: 3, parts: 2 }, /part/],
    ];
    for (const [over, reason] of cases) {
      const outcome = await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: { ...good, ...over } });
      expect(outcome.kind, JSON.stringify(over)).toBe('rejected');
      expect(outcome.kind === 'rejected' && outcome.reason).toMatch(reason);
    }
    expect(persistence.rows).toHaveLength(0);
  });

  test('a file in parts is put together, checked, and stored once complete', async () => {
    const { store, persistence } = newStore();
    const file = crypto.randomBytes(1000);
    const whole = backupOf(file, { round: 9 });
    const pieces = [file.subarray(0, 400), file.subarray(400, 800), file.subarray(800)];
    const part = (n: number): InlineBackup => ({ ...whole, data: pieces[n - 1].toString('base64'), part: n, parts: 3 });

    // Out of order, with a repeated part.
    expect(await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: part(2) })).toEqual({
      kind: 'partial',
      received: 1,
      parts: 3,
    });
    expect((await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: part(2) })).kind).toBe('partial');
    expect((await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: part(3) })).kind).toBe('partial');
    expect(persistence.rows).toHaveLength(0);
    const done = await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: part(1) });
    expect(done.kind).toBe('stored');
    expect(persistence.partCount()).toBe(0);
    const stored = await store.get(SLUG, 1, 9);
    expect(Buffer.from(stored!.data, 'base64').equals(file)).toBe(true);

    // Parts that do not add up to the announced file are refused.
    const bad = backupOf(file, { round: 10, sha256: 'a'.repeat(64) });
    await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: { ...bad, data: pieces[0].toString('base64'), part: 1, parts: 2 } });
    const refused = await store.ingest({
      matchSlug: SLUG,
      serverId: 's1',
      epoch: 1,
      backup: { ...bad, data: pieces[1].toString('base64'), part: 2, parts: 2 },
    });
    expect(refused.kind).toBe('rejected');
    expect(await store.get(SLUG, 1, 10)).toBeNull();
  });

  test('rounds voided by a restore are superseded; a new backup of the round clears it', async () => {
    const { store } = newStore();
    for (const round of [1, 2, 3, 4]) {
      await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: backupOf(`r${round}`, { round }) });
    }
    await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: backupOf('other map', { map_number: 2, round: 3 }) });
    expect(await store.roundsVoided(SLUG, 1, 2, 500)).toBe(2);
    const list = await store.list(SLUG);
    expect(list.map((b) => [b.mapNumber, b.round, b.supersededAt])).toEqual([
      [1, 1, null],
      [1, 2, null],
      [1, 3, 500],
      [1, 4, 500],
      [2, 3, null],
    ]);
    // Round 3 played again: its new backup is current again. The same file again too.
    await store.ingest({ matchSlug: SLUG, serverId: 's1', epoch: 1, backup: backupOf('r3', { round: 3 }) });
    expect((await store.get(SLUG, 1, 3))?.supersededAt).toBeNull();
  });

  test('retention: ended matches after N days, orphans by age; live and recent matches keep everything', async () => {
    const now = 100 * DAY;
    const ended: Record<string, number | null> = {
      live: null,
      recent: now - 2 * DAY,
      old: now - 20 * DAY,
    };
    const { store, persistence } = newStore((slug) => (slug in ended ? ended[slug] : undefined));
    const put = (slug: string, storedAt: number) =>
      store.ingest({ matchSlug: slug, serverId: 's1', epoch: 1, backup: backupOf(`${slug}-${storedAt}`) }, storedAt);
    await put('live', now - 30 * DAY);
    await put('recent', now - 30 * DAY);
    await put('old', now - 30 * DAY);
    await put('gone-old', now - 30 * DAY);
    await put('gone-new', now - DAY);
    // A part that never completed, a day and a half old.
    await store.ingest(
      { matchSlug: 'live', serverId: 's1', epoch: 1, backup: { ...backupOf('xy', { round: 7 }), data: 'eA==', part: 1, parts: 2 } },
      now - 1.5 * DAY
    );

    expect(await store.prune(0, now)).toBe(0);
    expect(persistence.rows).toHaveLength(5);

    expect(await store.prune(14, now)).toBe(2);
    expect(persistence.rows.map((r) => r.matchSlug).sort()).toEqual(['gone-new', 'live', 'recent']);
    expect(persistence.partCount()).toBe(0);
  });

  test('FLEET_BACKUP_RETENTION_DAYS', () => {
    expect(backupRetentionDays({})).toBe(14);
    expect(backupRetentionDays({ FLEET_BACKUP_RETENTION_DAYS: '3' })).toBe(3);
    expect(backupRetentionDays({ FLEET_BACKUP_RETENTION_DAYS: '0' })).toBe(0);
    expect(backupRetentionDays({ FLEET_BACKUP_RETENTION_DAYS: 'soon' })).toBe(14);
    expect(backupRetentionDays({ FLEET_BACKUP_RETENTION_DAYS: '-1' })).toBe(14);
  });

  test('fleet events: event.backup stored, a fenced server ignored, rounds_voided supersedes', async () => {
    const { store, persistence } = newStore();
    const frame = example('live.event.backup.json');
    const env = { ...frame, payload: { ...frame.payload, match_id: SLUG } } as Envelope;
    expect(await handleBackupEvent(store, { serverId: 'zombie', envelope: env, patch: 'stale_epoch' })).toBeNull();
    expect(persistence.rows).toHaveLength(0);
    const outcome = await handleBackupEvent(store, { serverId: 'srv', envelope: env, patch: 'applied' });
    expect(outcome && typeof outcome === 'object' && outcome.kind).toBe('stored');
    // A replay of the same event (after a restart) stores nothing new.
    const replay = await handleBackupEvent(store, { serverId: 'srv', envelope: env, patch: 'duplicate' });
    expect(replay && typeof replay === 'object' && replay.kind).toBe('duplicate');

    await store.ingest({ matchSlug: SLUG, serverId: 'srv', epoch: 2, backup: backupOf('r4', { round: 4 }) });
    const voided = example('live.event.rounds_voided.json');
    const voidEnv = {
      ...voided,
      payload: { ...voided.payload, match_id: SLUG, map_number: 1, data: { from_round: 2, reason: 'restore' } },
    } as Envelope;
    expect(await handleBackupEvent(store, { serverId: 'srv', envelope: voidEnv, patch: 'applied' })).toBe(1);
    expect((await store.get(SLUG, 1, 4))?.supersededAt).not.toBeNull();
    expect((await store.get(SLUG, 1, 1))?.supersededAt).toBeNull();

    const other = example('live.event.pause.json');
    expect(await handleBackupEvent(store, { serverId: 'srv', envelope: other, patch: 'applied' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

function liveRecord(over: Partial<LiveMatchRecord> = {}): LiveMatchRecord {
  return {
    matchSlug: SLUG,
    epoch: 3,
    serverId: 'srv_b',
    liveRev: 10,
    configRev: 1,
    state: null,
    mapStats: null,
    mapRounds: {},
    needsSnapshot: false,
    updatedAt: 0,
    ...over,
  };
}

function command(id: string, over: Partial<FleetCommandRecord> = {}): FleetCommandRecord {
  return {
    id,
    serverId: 'srv_b',
    seq: 1,
    type: 'cmd',
    matchSlug: SLUG,
    epoch: 3,
    name: 'restore_round',
    status: 'ok',
    errorCode: null,
    result: { status: 'ok' },
    createdAt: 0,
    answeredAt: 1,
    ...over,
  };
}

function restoreDeps(over: Partial<RestoreDeps> = {}) {
  const { store } = newStore();
  const audit = createMemoryRestoreAudit();
  const sent: Array<{ serverId: string; payload: CmdPayload; epoch: number }> = [];
  const rcon: Array<{ serverId: string; round: number }> = [];
  let answer: (id: string) => FleetCommandRecord | null = (id) => command(id);
  const deps: RestoreDeps = {
    backups: store,
    audit,
    getLiveState: async () => liveRecord(),
    async sendCmd(serverId, payload, epoch) {
      // The real sendReliable refuses a payload that fails the schema.
      const check = validatePayload('cmd', payload as unknown as Record<string, unknown>);
      if (!check.ok) throw new Error(`invalid cmd: ${check.errors.join('; ')}`);
      sent.push({ serverId, payload, epoch });
      return { id: `cmd-${sent.length}`, seq: sent.length, delivered: true, answered: true };
    },
    awaitResult: async (id) => answer(id),
    rconServerFor: async () => null,
    async rconRestore(serverId, round) {
      rcon.push({ serverId, round });
      return { success: true };
    },
    now: () => 1_000_000_000_000,
    ...over,
  };
  return {
    deps,
    store,
    audit,
    sent,
    rcon,
    setAnswer(fn: (id: string) => FleetCommandRecord | null) {
      answer = fn;
    },
  };
}

const ACTOR = { id: '76561198000000001', name: 'Admin' };

test.describe('Restore to round N', () => {
  test('fleet: cmd restore_round with the stored backup inline, to the server of the current epoch, audited', async () => {
    const ctx = restoreDeps();
    // Stored from server A; the match has since moved to server B (epoch 3).
    const backup = backupOf('the backup of round 5');
    await ctx.store.ingest({ matchSlug: SLUG, serverId: 'srv_a', epoch: 2, backup });

    const { restore, delivered } = await restoreRoundBackup(ctx.deps, {
      matchSlug: SLUG,
      mapNumber: 1,
      round: 5,
      actor: ACTOR,
    });
    expect(delivered).toBe(true);
    expect(ctx.sent).toHaveLength(1);
    const { serverId, payload, epoch } = ctx.sent[0];
    expect(serverId).toBe('srv_b');
    expect(epoch).toBe(3);
    expect(payload).toMatchObject({
      match_id: SLUG,
      epoch: 3,
      name: 'restore_round',
      issued_by: { user_id: ACTOR.id, name: 'Admin', root: false },
      audit_id: restore.id,
    });
    expect(payload.expires_at).toBeGreaterThan(1_000_000_000_000);
    expect(payload.args).toEqual({ map_number: 1, round: 5, backup: { ...backup } });

    expect(restore).toMatchObject({
      transport: 'fleet',
      status: 'ok',
      serverId: 'srv_b',
      epoch: 3,
      inline: true,
      backupSha256: backup.sha256,
      commandId: 'cmd-1',
      actor: ACTOR.id,
    });
    expect(ctx.audit.records).toHaveLength(1);
    expect(ctx.audit.records[0]).toMatchObject({ status: 'ok', commandId: 'cmd-1', answeredAt: 1_000_000_000 });
  });

  test('fleet: the server refuses it (checksum); no answer in time stays pending and is settled later', async () => {
    const ctx = restoreDeps();
    await ctx.store.ingest({ matchSlug: SLUG, serverId: 'srv_b', epoch: 3, backup: backupOf('r5') });
    ctx.setAnswer((id) =>
      command(id, { status: 'rejected', errorCode: 'checksum', result: { status: 'rejected', error: { code: 'checksum', message: 'sha256 mismatch' } } })
    );
    const refused = await restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 5, actor: ACTOR });
    expect(refused.restore).toMatchObject({ status: 'rejected', errorCode: 'checksum', errorMessage: 'sha256 mismatch' });

    ctx.setAnswer(() => null);
    const pending = await restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 5, actor: ACTOR });
    expect(pending.restore.status).toBe('pending');
    const row = ctx.audit.records.find((r) => r.id === pending.restore.id)!;
    expect(row).toMatchObject({ status: 'pending', commandId: 'cmd-2', answeredAt: null });

    // The answer arrives later (the cmd.result hook).
    await settleRestoreFromCommand(
      ctx.audit,
      command('cmd-2', { result: { status: 'ok', audit_id: pending.restore.id } }),
      2_000_000_000_000
    );
    expect(row).toMatchObject({ status: 'ok', answeredAt: 2_000_000_000 });
  });

  test('fleet: no such backup, no assignment, bad arguments', async () => {
    const ctx = restoreDeps();
    const run = (over: Partial<{ mapNumber: number; round: number }> = {}) =>
      restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 5, actor: ACTOR, ...over });
    await expect(run()).rejects.toMatchObject({ code: 'no_backup', status: 404 });
    await expect(run({ round: 0 })).rejects.toMatchObject({ code: 'bad_args', status: 400 });
    await expect(run({ mapNumber: 10 })).rejects.toMatchObject({ code: 'bad_args', status: 400 });
    ctx.deps.getLiveState = async () => liveRecord({ serverId: null });
    await expect(run()).rejects.toBeInstanceOf(RestoreError);
    await expect(run()).rejects.toMatchObject({ code: 'not_assigned', status: 409 });
    expect(ctx.sent).toHaveLength(0);
    expect(ctx.audit.records).toHaveLength(0);
  });

  test('fleet: a file too large for one frame goes without it to the server that wrote it, and nowhere else', async () => {
    const ctx = restoreDeps();
    const big = crypto.randomBytes(Math.ceil((MAX_INLINE_DATA_CHARS * 3) / 4) + 3000);
    const whole = backupOf(big, { round: 6 });
    const half = Math.floor(big.length / 2);
    for (const [n, piece] of [big.subarray(0, half), big.subarray(half)].entries()) {
      await ctx.store.ingest({
        matchSlug: SLUG,
        serverId: 'srv_a',
        epoch: 2,
        backup: { ...whole, data: piece.toString('base64'), part: n + 1, parts: 2 },
      });
    }
    await expect(
      restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 6, actor: ACTOR })
    ).rejects.toMatchObject({ code: 'too_large', status: 422 });

    ctx.deps.getLiveState = async () => liveRecord({ serverId: 'srv_a', epoch: 2 });
    const { restore } = await restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 6, actor: ACTOR });
    expect(restore).toMatchObject({ status: 'ok', inline: false });
    expect(ctx.sent[0].payload.args).toEqual({ map_number: 1, round: 6 });
  });

  test('fleet: a send the outbox refuses is recorded as failed', async () => {
    const ctx = restoreDeps({
      sendCmd: async () => {
        throw new Error('server gone');
      },
    });
    await ctx.store.ingest({ matchSlug: SLUG, serverId: 'srv_b', epoch: 3, backup: backupOf('r5') });
    await expect(
      restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 5, actor: ACTOR })
    ).rejects.toMatchObject({ code: 'send_failed' });
    expect(ctx.audit.records[0]).toMatchObject({ status: 'failed', errorCode: 'send_failed', errorMessage: 'server gone' });
  });

  test('rcon: css_restore on the match server, audited; a failure is recorded', async () => {
    const ctx = restoreDeps({ getLiveState: async () => null, rconServerFor: async () => 'server-3' });
    const { restore } = await restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 7, actor: ACTOR });
    expect(ctx.rcon).toEqual([{ serverId: 'server-3', round: 7 }]);
    expect(ctx.sent).toHaveLength(0);
    expect(restore).toMatchObject({ transport: 'rcon', status: 'ok', serverId: 'server-3', backupId: null });

    ctx.deps.rconRestore = async () => ({ success: false, error: 'Connection refused' });
    const failed = await restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 7, actor: ACTOR });
    expect(failed.restore).toMatchObject({ status: 'failed', errorCode: 'rcon', errorMessage: 'Connection refused' });
    expect(ctx.audit.records.map((r) => r.status)).toEqual(['ok', 'failed']);

    ctx.deps.rconServerFor = async () => null;
    await expect(
      restoreRoundBackup(ctx.deps, { matchSlug: SLUG, mapNumber: 1, round: 7, actor: ACTOR })
    ).rejects.toMatchObject({ code: 'not_assigned' });
  });
});
