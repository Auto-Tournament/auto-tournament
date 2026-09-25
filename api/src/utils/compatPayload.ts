/**
 * The Ready Up compatibility document (`compat.json`, schema 1) and its
 * validator.
 *
 * Ready Up's CI checks each CS2 build against the plugin suite and publishes
 * one of these per run, either pushed to `POST /api/compat/events` or served
 * as a file the instance polls (`COMPAT_FEED_URL`). The shape is a contract
 * with that CI: keep it exactly, and bump `schema` for anything that is not.
 *
 * Validation is strict on purpose. The document is rendered on a public page,
 * so every string is bounded, every enum is closed, unknown keys are refused
 * (a typo in the producer should fail loudly there, not render as a missing
 * field here) and `run.url` must be http(s), never `javascript:`.
 *
 * Pure: no Express, no database, so it is tested in process.
 */

export const COMPAT_SCHEMA_VERSION = 1;

export const COMPAT_TRIGGERS = ['build_change', 'surface_change', 'nightly', 'release', 'manual'] as const;
export const COMPAT_STAGES = ['static', 'selftest', 'live'] as const;
export const COMPAT_RUN_STATES = ['queued', 'checking', 'pass', 'warn', 'fail', 'no_verdict'] as const;
export const COMPAT_OVERALL = ['pass', 'warn', 'fail', 'checking', 'no_verdict'] as const;
export const COMPAT_COMPONENT_STATUSES = ['pass', 'warn', 'fail', 'pending', 'checking'] as const;
export const COMPAT_CHECK_KINDS = [
  'signature',
  'rtti',
  'vtable',
  'hook_site',
  'layout',
  'schema',
  'event',
  'selftest',
  'livetest',
] as const;
export const COMPAT_CHECK_STATUSES = ['pass', 'warn', 'fail', 'pending'] as const;

export type CompatTrigger = (typeof COMPAT_TRIGGERS)[number];
export type CompatStage = (typeof COMPAT_STAGES)[number];
export type CompatRunState = (typeof COMPAT_RUN_STATES)[number];
export type CompatOverall = (typeof COMPAT_OVERALL)[number];
export type CompatComponentStatus = (typeof COMPAT_COMPONENT_STATUSES)[number];
export type CompatCheckKind = (typeof COMPAT_CHECK_KINDS)[number];
export type CompatCheckStatus = (typeof COMPAT_CHECK_STATUSES)[number];

export interface CompatCheck {
  kind: CompatCheckKind;
  status: CompatCheckStatus;
  passed: number;
  total: number;
  failures: string[];
}

export interface CompatComponent {
  id: string;
  name: string;
  status: CompatComponentStatus;
  checks: CompatCheck[];
}

export interface CompatRun {
  id: string;
  url: string;
  trigger: CompatTrigger;
  stage: CompatStage;
  state: CompatRunState;
  started_at: string;
  finished_at: string | null;
}

/** One `compat.json`, as the Ready Up CI writes it. */
export interface CompatDocument {
  schema: typeof COMPAT_SCHEMA_VERSION;
  cs2: { buildid: string; patch: string };
  readyup: { version: string; commit: string };
  run: CompatRun;
  overall: CompatOverall;
  components: CompatComponent[];
  checked_at: string;
}

/** Largest request body `POST /api/compat/events` reads, and largest feed file fetched. */
export const COMPAT_MAX_BYTES = 256 * 1024;

export const COMPAT_LIMITS = {
  components: 32,
  checksPerComponent: 32,
  failuresPerCheck: 200,
  failureLength: 500,
  nameLength: 64,
  versionLength: 64,
  urlLength: 2048,
  checkCount: 1_000_000,
} as const;

const BUILDID = /^[0-9]{1,20}$/;
const PATCH = /^[0-9]{1,6}(\.[0-9]{1,6}){1,4}$/;
const COMMIT = /^[0-9a-fA-F]{7,64}$/;
const RUN_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const COMPONENT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** RFC 3339 date-time: `2026-09-25T12:00:00Z`, optional fraction, `Z` or an offset. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
/** Control characters (tabs and newlines included) have no place in a label. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type CompatValidation =
  | { ok: true; value: CompatDocument }
  | { ok: false; errors: string[] };

class Checker {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    // A document with thousands of bad entries does not need thousands of lines.
    if (this.errors.length < 50) this.errors.push(`${path}: ${message}`);
  }

  object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be an object');
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) this.fail(path ? `${path}.${key}` : key, 'is not a known field');
    }
    for (const key of keys) {
      if (!(key in record)) this.fail(path ? `${path}.${key}` : key, 'is required');
    }
    return record;
  }

  string(value: unknown, path: string, opts: { max: number; pattern?: RegExp; label?: string }): string | null {
    if (typeof value !== 'string') {
      this.fail(path, 'must be a string');
      return null;
    }
    if (value.length === 0 || value.length > opts.max) {
      this.fail(path, `must be 1-${opts.max} characters`);
      return null;
    }
    if (opts.pattern && !opts.pattern.test(value)) {
      this.fail(path, opts.label ?? 'has an invalid format');
      return null;
    }
    if (!opts.pattern && CONTROL_CHARS.test(value)) {
      this.fail(path, 'must not contain control characters');
      return null;
    }
    return value;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(path, `must be one of ${allowed.join(', ')}`);
      return null;
    }
    return value as T;
  }

  /** An ISO timestamp, normalised to UTC `toISOString()` form so it sorts as text. */
  timestamp(value: unknown, path: string): string | null {
    if (typeof value !== 'string' || value.length > 40 || !ISO_DATETIME.test(value)) {
      this.fail(path, 'must be an ISO 8601 date-time (e.g. 2026-09-25T12:00:00Z)');
      return null;
    }
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
      this.fail(path, 'is not a real date');
      return null;
    }
    return new Date(ms).toISOString();
  }

  count(value: unknown, path: string): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > COMPAT_LIMITS.checkCount) {
      this.fail(path, `must be an integer from 0 to ${COMPAT_LIMITS.checkCount}`);
      return null;
    }
    return value;
  }

  array(value: unknown, path: string, max: number): unknown[] | null {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array');
      return null;
    }
    if (value.length > max) {
      this.fail(path, `must have at most ${max} entries`);
      return null;
    }
    return value;
  }
}

function httpUrl(checker: Checker, value: unknown, path: string): string | null {
  const text = checker.string(value, path, { max: COMPAT_LIMITS.urlLength });
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' || url.protocol === 'http:') return text;
  } catch {
    // Reported below.
  }
  checker.fail(path, 'must be an http(s) URL');
  return null;
}

function validateCheck(c: Checker, value: unknown, path: string): CompatCheck | null {
  const raw = c.object(value, path, ['kind', 'status', 'passed', 'total', 'failures']);
  if (!raw) return null;
  const kind = c.oneOf(raw.kind, `${path}.kind`, COMPAT_CHECK_KINDS);
  const status = c.oneOf(raw.status, `${path}.status`, COMPAT_CHECK_STATUSES);
  const passed = c.count(raw.passed, `${path}.passed`);
  const total = c.count(raw.total, `${path}.total`);
  if (passed !== null && total !== null && passed > total) {
    c.fail(`${path}.passed`, 'must not be more than total');
  }
  const list = c.array(raw.failures, `${path}.failures`, COMPAT_LIMITS.failuresPerCheck);
  const failures: string[] = [];
  list?.forEach((entry, i) => {
    const text = c.string(entry, `${path}.failures[${i}]`, { max: COMPAT_LIMITS.failureLength });
    if (text !== null) failures.push(text);
  });
  if (kind === null || status === null || passed === null || total === null || list === null) return null;
  return { kind, status, passed, total, failures };
}

function validateComponent(c: Checker, value: unknown, path: string): CompatComponent | null {
  const raw = c.object(value, path, ['id', 'name', 'status', 'checks']);
  if (!raw) return null;
  const id = c.string(raw.id, `${path}.id`, {
    max: 32,
    pattern: COMPONENT_ID,
    label: 'must be lowercase letters, digits, - or _',
  });
  const name = c.string(raw.name, `${path}.name`, { max: COMPAT_LIMITS.nameLength });
  const status = c.oneOf(raw.status, `${path}.status`, COMPAT_COMPONENT_STATUSES);
  const list = c.array(raw.checks, `${path}.checks`, COMPAT_LIMITS.checksPerComponent);
  const checks: CompatCheck[] = [];
  list?.forEach((entry, i) => {
    const check = validateCheck(c, entry, `${path}.checks[${i}]`);
    if (check) checks.push(check);
  });
  if (id === null || name === null || status === null || list === null) return null;
  return { id, name, status, checks };
}

/**
 * Check `input` against the schema-1 contract. On success `value` is a fresh
 * object holding exactly the contract's fields, in the contract's order, with
 * timestamps normalised to UTC; on failure `errors` names each bad path.
 */
export function validateCompatDocument(input: unknown): CompatValidation {
  const c = new Checker();
  const raw = c.object(input, '', ['schema', 'cs2', 'readyup', 'run', 'overall', 'components', 'checked_at']);
  if (!raw) return { ok: false, errors: c.errors };

  if (raw.schema !== COMPAT_SCHEMA_VERSION) {
    c.fail('schema', `must be ${COMPAT_SCHEMA_VERSION}`);
  }

  const cs2Raw = c.object(raw.cs2, 'cs2', ['buildid', 'patch']);
  const buildid = cs2Raw
    ? c.string(cs2Raw.buildid, 'cs2.buildid', { max: 20, pattern: BUILDID, label: 'must be a numeric Steam build id' })
    : null;
  const patch = cs2Raw
    ? c.string(cs2Raw.patch, 'cs2.patch', { max: 32, pattern: PATCH, label: 'must be a dotted version like 1.41.8.5' })
    : null;

  const readyupRaw = c.object(raw.readyup, 'readyup', ['version', 'commit']);
  const version = readyupRaw
    ? c.string(readyupRaw.version, 'readyup.version', { max: COMPAT_LIMITS.versionLength })
    : null;
  const commit = readyupRaw
    ? c.string(readyupRaw.commit, 'readyup.commit', { max: 64, pattern: COMMIT, label: 'must be a hex commit sha' })
    : null;

  const runRaw = c.object(raw.run, 'run', ['id', 'url', 'trigger', 'stage', 'state', 'started_at', 'finished_at']);
  let run: CompatRun | null = null;
  if (runRaw) {
    const id = c.string(runRaw.id, 'run.id', { max: 128, pattern: RUN_ID, label: 'must be letters, digits, . _ : or -' });
    const url = httpUrl(c, runRaw.url, 'run.url');
    const trigger = c.oneOf(runRaw.trigger, 'run.trigger', COMPAT_TRIGGERS);
    const stage = c.oneOf(runRaw.stage, 'run.stage', COMPAT_STAGES);
    const state = c.oneOf(runRaw.state, 'run.state', COMPAT_RUN_STATES);
    const startedAt = c.timestamp(runRaw.started_at, 'run.started_at');
    const finishedAt = runRaw.finished_at === null ? null : c.timestamp(runRaw.finished_at, 'run.finished_at');
    const finishedOk = runRaw.finished_at === null || finishedAt !== null;
    if (id && url && trigger && stage && state && startedAt && finishedOk) {
      run = { id, url, trigger, stage, state, started_at: startedAt, finished_at: finishedAt };
    }
  }

  const overall = c.oneOf(raw.overall, 'overall', COMPAT_OVERALL);

  const componentList = c.array(raw.components, 'components', COMPAT_LIMITS.components);
  const components: CompatComponent[] = [];
  const seen = new Set<string>();
  componentList?.forEach((entry, i) => {
    const component = validateComponent(c, entry, `components[${i}]`);
    if (!component) return;
    if (seen.has(component.id)) {
      c.fail(`components[${i}].id`, `duplicates "${component.id}"`);
      return;
    }
    seen.add(component.id);
    components.push(component);
  });

  const checkedAt = c.timestamp(raw.checked_at, 'checked_at');

  if (
    c.errors.length > 0 ||
    buildid === null ||
    patch === null ||
    version === null ||
    commit === null ||
    run === null ||
    overall === null ||
    componentList === null ||
    checkedAt === null
  ) {
    return { ok: false, errors: c.errors.length > 0 ? c.errors : ['document is invalid'] };
  }

  return {
    ok: true,
    value: {
      schema: COMPAT_SCHEMA_VERSION,
      cs2: { buildid, patch },
      readyup: { version, commit },
      run,
      overall,
      components,
      checked_at: checkedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// shields.io endpoint badge
// ---------------------------------------------------------------------------

/** https://shields.io/badges/endpoint-badge */
export interface ShieldsEndpointBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  cacheSeconds: number;
}

const BADGE_WORDING: Record<CompatOverall, { message: string; color: string }> = {
  pass: { message: 'compatible', color: 'brightgreen' },
  warn: { message: 'warnings', color: 'yellow' },
  fail: { message: 'incompatible', color: 'red' },
  checking: { message: 'checking', color: 'blue' },
  no_verdict: { message: 'no verdict', color: 'lightgrey' },
};

/** The badge for the latest document, or "unknown" when there is none yet. */
export function compatBadge(doc: CompatDocument | null): ShieldsEndpointBadge {
  const base = { schemaVersion: 1 as const, label: 'Ready Up', cacheSeconds: 300 };
  if (!doc) return { ...base, message: 'unknown', color: 'lightgrey' };
  const { message, color } = BADGE_WORDING[doc.overall];
  return { ...base, message: `${message} · CS2 ${doc.cs2.patch}`, color };
}
