/**
 * Ready Up compatibility, as the API answers it (api/src/types/compat.types.ts
 * and api/src/utils/compatPayload.ts). Field names are the `compat.json`
 * contract's, so they stay snake_case.
 */

export type CompatOverall = 'pass' | 'warn' | 'fail' | 'checking' | 'no_verdict';
export type CompatRunState = 'queued' | 'checking' | 'pass' | 'warn' | 'fail' | 'no_verdict';
export type CompatComponentStatus = 'pass' | 'warn' | 'fail' | 'pending' | 'checking';
export type CompatCheckStatus = 'pass' | 'warn' | 'fail' | 'pending';
export type CompatStage = 'static' | 'selftest' | 'live';
export type CompatTrigger = 'build_change' | 'surface_change' | 'nightly' | 'release' | 'manual';
export type CompatCheckKind =
  | 'signature'
  | 'rtti'
  | 'vtable'
  | 'hook_site'
  | 'layout'
  | 'schema'
  | 'event'
  | 'selftest'
  | 'livetest';

export interface CompatCheck {
  kind: CompatCheckKind;
  status: CompatCheckStatus;
  passed: number;
  total: number;
  failures: string[];
}

interface CompatRunBase {
  schema: 1;
  cs2: { buildid: string; patch: string };
  readyup: { version: string; commit: string };
  run: {
    id: string;
    url: string;
    trigger: CompatTrigger;
    stage: CompatStage;
    state: CompatRunState;
    started_at: string;
    finished_at: string | null;
  };
  overall: CompatOverall;
  checked_at: string;
  source: 'push' | 'pull';
  received_at: string;
  updated_at: string;
}

/** `GET /api/compat/latest`: every component with its checks. */
export interface CompatSnapshot extends CompatRunBase {
  components: Array<{ id: string; name: string; status: CompatComponentStatus; checks: CompatCheck[] }>;
}

/** `GET /api/compat/runs`: each component's status only. */
export interface CompatRunSummary extends CompatRunBase {
  components: Array<{ id: string; name: string; status: CompatComponentStatus }>;
}

/** Socket.IO `compat:update`. */
export interface CompatUpdateEvent {
  latest: CompatSnapshot | null;
  run: CompatRunSummary;
}
