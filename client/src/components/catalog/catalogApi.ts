/**
 * The game catalog's API (`/api/catalog`, DESIGN-modules §10): one list of
 * packs and code modules, and the operations on them. Admin-only.
 */

import { api } from '../../utils/api';

export type CatalogKind = 'pack' | 'module';

export type CatalogState =
  | 'available'
  | 'installed'
  | 'update-available'
  | 'disabled'
  | 'broken'
  | 'incompatible'
  | 'builtin';

export interface CatalogItem {
  kind: CatalogKind;
  id: string;
  name: string;
  description: string | null;
  /** Same-origin tile URL, or null. */
  icon: string | null;
  engine: string | null;
  state: CatalogState;
  reason: string | null;
  installed: {
    version: string | null;
    source: string;
    enabled: boolean;
    /** Code modules from the catalog: the key their release was signed with. */
    keyId?: string | null;
    keyLabel?: string | null;
  } | null;
  available: { version: string | null; from: 'remote' | 'snapshot' } | null;
  restartRequired: boolean;
  /** What boot's automatic update did not do: a failure, or a new major version waiting for the admin. */
  notice?: string | null;
}

export interface CatalogListing {
  feed: {
    from: 'remote' | 'cache' | 'none';
    stale: boolean;
    /** A code, translated under `catalog.feed.reason`: `timeout`, `unreachable`, `bad_response`, `newer_schema`, `too_large`, `offline`, `http_<status>`. */
    error: string | null;
    /** When the listed feed was fetched; for `cache`, when the copy was written. */
    fetchedAt?: string | null;
    /** The server is still fetching the feed: list again shortly. */
    refreshing?: boolean;
  };
  platform: { serverApi: string; clientApi: string };
  items: CatalogItem[];
}

export interface CatalogResult {
  item: CatalogItem | null;
  restartRequired: boolean;
  message: string;
}

export type CatalogAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall';

export interface CatalogUpdateAllResult {
  updated: Array<{ kind: CatalogKind; id: string; from: string | null; to: string | null }>;
  skipped: Array<{ kind: CatalogKind; id: string; reason: string }>;
  failed: Array<{ kind: CatalogKind; id: string; error: string }>;
  restartRequired: boolean;
}

/** Whether this instance can restart itself (a supervisor brings it back), and if not, why. */
export function fetchRestartSupport(): Promise<{ supported: boolean; reason: string | null }> {
  return api.get<{ supported: boolean; reason: string | null }>('/api/system/restart');
}

/** Ask the server to restart. Answers 202 before it goes down. */
export function requestRestart(): Promise<unknown> {
  return api.post('/api/system/restart', {});
}

/**
 * Poll `/health` until a new process answers: its uptime is shorter than
 * the time since the restart was asked for. False after `timeoutMs`.
 */
export async function waitForServer(since: number, timeoutMs = 180_000): Promise<boolean> {
  while (Date.now() - since < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const uptime = await fetch('/health', { cache: 'no-store' }).then(
      async (response) => (response.ok ? ((await response.json()) as { uptime?: number }).uptime : undefined),
      () => undefined
    );
    if (typeof uptime === 'number' && uptime < (Date.now() - since) / 1000) return true;
  }
  return false;
}

export function fetchCatalog(): Promise<CatalogListing> {
  return api.get<CatalogListing>('/api/catalog');
}

function base(item: Pick<CatalogItem, 'kind' | 'id'>): string {
  return `/api/catalog/${item.kind === 'pack' ? 'packs' : 'modules'}/${encodeURIComponent(item.id)}`;
}

/**
 * Run one operation. Every write is a same-origin JSON request, which the
 * API requires (its CSRF check), so even the bodiless ones send `{}`.
 */
export function runCatalogAction(item: Pick<CatalogItem, 'kind' | 'id'>, action: CatalogAction): Promise<CatalogResult> {
  if (action === 'uninstall') {
    return api.fetch(base(item), { method: 'DELETE', body: '{}' }) as Promise<CatalogResult>;
  }
  // A pack has no update endpoint of its own: installing a newer copy is it.
  const verb = item.kind === 'pack' && action === 'update' ? 'install' : action;
  return api.post<CatalogResult>(`${base(item)}/${verb}`, {});
}

/** Update every installed pack and code module that has a compatible newer version, one after another. */
export function runCatalogUpdateAll(): Promise<CatalogUpdateAllResult> {
  return api.post<CatalogUpdateAllResult>('/api/catalog/update-all', {});
}
