/**
 * Ready Up compatibility: the runs the Ready Up CI reports, stored and served
 * on a public page (`/compatibility`).
 *
 * Two ways in, both ending in `ingestCompatDocument`:
 * - push: the CI posts each `compat.json` to `POST /api/compat/events` with
 *   `Authorization: Bearer <COMPAT_INGEST_TOKEN>` (routes/compat.ts);
 * - pull: with `COMPAT_FEED_URL` set, the instance fetches that file every
 *   five minutes (services/compatFeedService.ts).
 *
 * A run is upserted by its `run.id`, so one CI run moving from `queued` to
 * `checking` to `pass` is one row. Nothing is stored or emitted when a
 * document says nothing new, and a document older (`checked_at`) than the
 * stored copy of the same run is ignored, so an out-of-order push or a feed
 * that lags the pushes cannot roll a run back. Every stored change goes to
 * the page's sockets as `compat:update`. Only the newest `COMPAT_HISTORY_LIMIT`
 * runs are kept.
 *
 * The feature is off unless an operator sets one of the two variables: the
 * endpoints answer 404 and the page says so.
 */

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitCompatUpdate } from './socketService';
import type { CompatCheck, CompatComponentStatus, CompatDocument } from '../utils/compatPayload';
import type { CompatRunSummary, CompatSnapshot, CompatSource } from '../types/compat.types';

/** Runs kept; older ones are deleted with their components. */
export const COMPAT_HISTORY_LIMIT = 200;

/** Same floor as the service tokens (utils/serviceTokens.ts). */
export const COMPAT_MIN_TOKEN_LENGTH = 16;

/** Serialises ingests, so two copies of one run cannot interleave. */
const COMPAT_INGEST_LOCK_KEY = 7_319_460_031;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The ingest token, or null when unset or too short to be safe (push disabled). */
export function compatIngestToken(): string | null {
  const token = (process.env.COMPAT_INGEST_TOKEN ?? '').trim();
  return token.length >= COMPAT_MIN_TOKEN_LENGTH ? token : null;
}

/** The feed URL, or null when unset or not http(s) (pull disabled). */
export function compatFeedUrl(): string | null {
  const raw = (process.env.COMPAT_FEED_URL ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Whether this instance shows compatibility at all: one of the two inputs is configured. */
export function isCompatEnabled(): boolean {
  return compatIngestToken() !== null || compatFeedUrl() !== null;
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Whether `authorization` (the raw header) is `Bearer <COMPAT_INGEST_TOKEN>`.
 * Compared in constant time over SHA-256 digests, so neither the token nor
 * its length leaks through timing.
 */
export function isValidCompatIngestAuth(authorization: string | undefined): boolean {
  const expected = compatIngestToken();
  if (!expected || typeof authorization !== 'string') return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  const presented = match ? match[1] : '';
  // Always compare, even with nothing presented, so a missing token takes as long as a wrong one.
  const same = crypto.timingSafeEqual(sha256(presented), sha256(expected));
  return same && presented.length > 0;
}

/** One line at boot on what is configured, and why a value was ignored. */
export function reportCompatConfig(): void {
  const rawToken = (process.env.COMPAT_INGEST_TOKEN ?? '').trim();
  if (rawToken && !compatIngestToken()) {
    log.warn(
      `[Startup] COMPAT_INGEST_TOKEN is shorter than ${COMPAT_MIN_TOKEN_LENGTH} characters and was ignored: ` +
        'POST /api/compat/events stays disabled. Generate one with `openssl rand -hex 32`.'
    );
  }
  const rawFeed = (process.env.COMPAT_FEED_URL ?? '').trim();
  if (rawFeed && !compatFeedUrl()) {
    log.warn('[Startup] COMPAT_FEED_URL is not an http(s) URL and was ignored.');
  }
  if (isCompatEnabled()) {
    const inputs = [compatIngestToken() ? 'push' : null, compatFeedUrl() ? 'pull (every 5 min)' : null]
      .filter(Boolean)
      .join(' + ');
    log.info(`[Startup] Ready Up compatibility page enabled: ${inputs}`);
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface CompatRunRow {
  id: number;
  run_id: string;
  cs2_buildid: string;
  cs2_patch: string;
  readyup_version: string;
  readyup_commit: string;
  run_url: string;
  run_trigger: string;
  stage: string;
  state: string;
  overall: string;
  started_at: string;
  finished_at: string | null;
  checked_at: string;
  source: string;
  received_at: number;
  updated_at: number;
}

interface CompatComponentRow {
  run_pk: number;
  position: number;
  component_id: string;
  name: string;
  status: string;
  checks: string;
}

const RUN_COLUMNS = `id, run_id, cs2_buildid, cs2_patch, readyup_version, readyup_commit, run_url,
  run_trigger, stage, state, overall, started_at, finished_at, checked_at, source, received_at, updated_at`;

/** Newest first: by when the run started, then by when it was first stored. */
const NEWEST_FIRST = 'ORDER BY started_at DESC, id DESC';

function isoFromEpoch(seconds: number): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

function parseChecks(text: string): CompatCheck[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as CompatCheck[]) : [];
  } catch {
    return [];
  }
}

/** The document a run row and its component rows hold, in the contract's field order. */
function toDocument(row: CompatRunRow, components: CompatComponentRow[]): CompatDocument {
  return {
    schema: 1,
    cs2: { buildid: row.cs2_buildid, patch: row.cs2_patch },
    readyup: { version: row.readyup_version, commit: row.readyup_commit },
    run: {
      id: row.run_id,
      url: row.run_url,
      trigger: row.run_trigger as CompatDocument['run']['trigger'],
      stage: row.stage as CompatDocument['run']['stage'],
      state: row.state as CompatDocument['run']['state'],
      started_at: row.started_at,
      finished_at: row.finished_at,
    },
    overall: row.overall as CompatDocument['overall'],
    components: components
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c.component_id,
        name: c.name,
        status: c.status as CompatComponentStatus,
        checks: parseChecks(c.checks),
      })),
    checked_at: row.checked_at,
  };
}

function received(row: CompatRunRow) {
  return {
    source: (row.source === 'pull' ? 'pull' : 'push') as CompatSource,
    received_at: isoFromEpoch(row.received_at),
    updated_at: isoFromEpoch(row.updated_at),
  };
}

function toSnapshot(row: CompatRunRow, components: CompatComponentRow[]): CompatSnapshot {
  return { ...toDocument(row, components), ...received(row) };
}

function toSummary(row: CompatRunRow, components: CompatComponentRow[]): CompatRunSummary {
  const doc = toDocument(row, components);
  return {
    ...doc,
    ...received(row),
    components: doc.components.map(({ id, name, status }) => ({ id, name, status })),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function componentsFor(runPks: number[]): Promise<Map<number, CompatComponentRow[]>> {
  const byRun = new Map<number, CompatComponentRow[]>();
  if (runPks.length === 0) return byRun;
  const rows = await db.queryAsync<CompatComponentRow>(
    'SELECT run_pk, position, component_id, name, status, checks FROM compat_components WHERE run_pk = ANY($1::int[]) ORDER BY run_pk, position',
    [runPks]
  );
  for (const row of rows) {
    const list = byRun.get(row.run_pk) ?? [];
    list.push(row);
    byRun.set(row.run_pk, list);
  }
  return byRun;
}

/** The newest run with every check, or null before the first one arrives. */
export async function getLatestCompat(): Promise<CompatSnapshot | null> {
  const row = await db.queryOneAsync<CompatRunRow>(
    `SELECT ${RUN_COLUMNS} FROM compat_runs ${NEWEST_FIRST} LIMIT 1`
  );
  if (!row) return null;
  const components = await componentsFor([row.id]);
  return toSnapshot(row, components.get(row.id) ?? []);
}

/** The newest `limit` runs (1..COMPAT_HISTORY_LIMIT), newest first, without the checks. */
export async function listCompatRuns(limit: number): Promise<CompatRunSummary[]> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), COMPAT_HISTORY_LIMIT);
  const rows = await db.queryAsync<CompatRunRow>(
    `SELECT ${RUN_COLUMNS} FROM compat_runs ${NEWEST_FIRST} LIMIT $1`,
    [bounded]
  );
  const components = await componentsFor(rows.map((r) => r.id));
  return rows.map((row) => toSummary(row, components.get(row.id) ?? []));
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export type CompatIngestResult =
  | { status: 'stored'; created: boolean; runId: string }
  | { status: 'unchanged'; runId: string }
  | { status: 'stale'; runId: string };

async function storeDocument(
  client: PoolClient,
  doc: CompatDocument,
  source: CompatSource
): Promise<{ result: CompatIngestResult; runPk: number | null }> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [COMPAT_INGEST_LOCK_KEY]);

  const existing = await client.query<CompatRunRow>(
    `SELECT ${RUN_COLUMNS} FROM compat_runs WHERE run_id = $1`,
    [doc.run.id]
  );
  const current = existing.rows[0];
  if (current) {
    // A copy checked earlier than the one stored is late, not news.
    if (doc.checked_at < current.checked_at) {
      return { result: { status: 'stale', runId: doc.run.id }, runPk: null };
    }
    const { rows: stored } = await client.query<CompatComponentRow>(
      'SELECT run_pk, position, component_id, name, status, checks FROM compat_components WHERE run_pk = $1',
      [current.id]
    );
    if (JSON.stringify(toDocument(current, stored)) === JSON.stringify(doc)) {
      return { result: { status: 'unchanged', runId: doc.run.id }, runPk: null };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const upserted = await client.query<{ id: number }>(
    `INSERT INTO compat_runs (
       run_id, cs2_buildid, cs2_patch, readyup_version, readyup_commit, run_url, run_trigger,
       stage, state, overall, started_at, finished_at, checked_at, source, received_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
     ON CONFLICT (run_id) DO UPDATE SET
       cs2_buildid = EXCLUDED.cs2_buildid,
       cs2_patch = EXCLUDED.cs2_patch,
       readyup_version = EXCLUDED.readyup_version,
       readyup_commit = EXCLUDED.readyup_commit,
       run_url = EXCLUDED.run_url,
       run_trigger = EXCLUDED.run_trigger,
       stage = EXCLUDED.stage,
       state = EXCLUDED.state,
       overall = EXCLUDED.overall,
       started_at = EXCLUDED.started_at,
       finished_at = EXCLUDED.finished_at,
       checked_at = EXCLUDED.checked_at,
       source = EXCLUDED.source,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [
      doc.run.id,
      doc.cs2.buildid,
      doc.cs2.patch,
      doc.readyup.version,
      doc.readyup.commit,
      doc.run.url,
      doc.run.trigger,
      doc.run.stage,
      doc.run.state,
      doc.overall,
      doc.run.started_at,
      doc.run.finished_at,
      doc.checked_at,
      source,
      now,
    ]
  );
  const runPk = upserted.rows[0].id;

  await client.query('DELETE FROM compat_components WHERE run_pk = $1', [runPk]);
  for (const [position, component] of doc.components.entries()) {
    await client.query(
      `INSERT INTO compat_components (run_pk, position, component_id, name, status, checks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [runPk, position, component.id, component.name, component.status, JSON.stringify(component.checks)]
    );
  }

  // History: the newest COMPAT_HISTORY_LIMIT runs stay (components cascade).
  await client.query(
    `DELETE FROM compat_runs WHERE id IN (
       SELECT id FROM compat_runs ${NEWEST_FIRST} OFFSET $1
     )`,
    [COMPAT_HISTORY_LIMIT]
  );

  return { result: { status: 'stored', created: !current, runId: doc.run.id }, runPk };
}

/**
 * Store a validated document (see `validateCompatDocument`) and tell the
 * page's sockets when anything changed.
 */
export async function ingestCompatDocument(
  doc: CompatDocument,
  source: CompatSource
): Promise<CompatIngestResult> {
  const { result, runPk } = await db.withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const outcome = await storeDocument(client, doc, source);
      await client.query('COMMIT');
      return outcome;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  });

  if (result.status === 'stored' && runPk !== null) {
    log.info(
      `[COMPAT] ${result.created ? 'New' : 'Updated'} run ${doc.run.id} (${source}): CS2 ${doc.cs2.patch} ` +
        `build ${doc.cs2.buildid}, ${doc.run.stage}/${doc.run.state}, overall ${doc.overall}`
    );
    try {
      const [latest, run] = await Promise.all([getLatestCompat(), getRunSummary(runPk)]);
      // The run can be gone already when it was older than the whole history.
      if (run) emitCompatUpdate({ latest, run });
    } catch (err) {
      log.warn(`[COMPAT] Stored run ${doc.run.id} but could not announce it: ${(err as Error).message}`);
    }
  }
  return result;
}

async function getRunSummary(runPk: number): Promise<CompatRunSummary | null> {
  const row = await db.queryOneAsync<CompatRunRow>(`SELECT ${RUN_COLUMNS} FROM compat_runs WHERE id = $1`, [
    runPk,
  ]);
  if (!row) return null;
  const components = await componentsFor([row.id]);
  return toSummary(row, components.get(row.id) ?? []);
}
