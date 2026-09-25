import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Ready Up compatibility test helpers: a valid schema-1 `compat.json` to
 * start from, and a push with the CI's token.
 *
 * CI sets COMPAT_INGEST_TOKEN to the default below (.github/workflows/ci.yml).
 */
export const COMPAT_TOKEN = process.env.COMPAT_INGEST_TOKEN || 'ci-compat-token-0123456789abcdef';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface CompatDoc {
  schema: number;
  cs2: { buildid: string; patch: string };
  readyup: { version: string; commit: string };
  run: {
    id: string;
    url: string;
    trigger: string;
    stage: string;
    state: string;
    started_at: string;
    finished_at: string | null;
  };
  overall: string;
  components: Array<{
    id: string;
    name: string;
    status: string;
    checks: Array<{ kind: string; status: string; passed: number; total: number; failures: string[] }>;
  }>;
  checked_at: string;
}

let counter = 0;

/** A unique run id, so specs never collide with each other's runs. */
export function uniqueRunId(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/**
 * A passing run started now: core (two checks, one of them a warning-free
 * signature scan) and match. Override any top-level field; `run` and `cs2`
 * are merged.
 */
export function compatDoc(overrides: DeepPartial<CompatDoc> = {}): CompatDoc {
  const now = new Date().toISOString();
  const base: CompatDoc = {
    schema: 1,
    cs2: { buildid: '25537370', patch: '1.41.8.5' },
    readyup: { version: '2.3.0', commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
    run: {
      id: uniqueRunId(),
      url: 'https://github.com/example/readyup/actions/runs/1',
      trigger: 'build_change',
      stage: 'static',
      state: 'pass',
      started_at: now,
      finished_at: now,
    },
    overall: 'pass',
    components: [
      {
        id: 'core',
        name: 'Core',
        status: 'pass',
        checks: [
          { kind: 'signature', status: 'pass', passed: 9, total: 9, failures: [] },
          { kind: 'vtable', status: 'pass', passed: 4, total: 4, failures: [] },
        ],
      },
      {
        id: 'match',
        name: 'Match',
        status: 'pass',
        checks: [{ kind: 'event', status: 'pass', passed: 12, total: 12, failures: [] }],
      },
    ],
    checked_at: now,
  };
  return {
    ...base,
    ...(overrides as Partial<CompatDoc>),
    cs2: { ...base.cs2, ...(overrides.cs2 ?? {}) },
    readyup: { ...base.readyup, ...(overrides.readyup ?? {}) },
    run: { ...base.run, ...(overrides.run ?? {}) } as CompatDoc['run'],
  };
}

/** POST a document with the CI's token; asserts it was accepted. */
export async function pushCompat(request: APIRequestContext, doc: CompatDoc) {
  const res = await request.post('/api/compat/events', {
    headers: { Authorization: `Bearer ${COMPAT_TOKEN}` },
    data: doc,
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { success: boolean; status: string; created?: boolean; runId: string };
}
