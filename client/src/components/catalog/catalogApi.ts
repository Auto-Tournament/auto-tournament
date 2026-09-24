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
}

export interface CatalogListing {
  feed: { from: 'remote' | 'cache' | 'none'; stale: boolean; error: string | null };
  platform: { serverApi: string; clientApi: string };
  items: CatalogItem[];
}

export interface CatalogResult {
  item: CatalogItem | null;
  restartRequired: boolean;
  message: string;
}

export type CatalogAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall';

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
