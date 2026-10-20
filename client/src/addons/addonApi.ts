import { api } from '../utils/api';

/** An add-on module as GET /api/addons lists it. */
export interface AddonView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  running: boolean;
  /** Why it is on but not running. */
  error: string | null;
}

export async function fetchAddons(): Promise<AddonView[]> {
  return (await api.get<{ addons: AddonView[] }>('/api/addons')).addons;
}

export async function setAddonEnabled(id: string, enabled: boolean): Promise<AddonView> {
  return (await api.put<{ addon: AddonView }>(`/api/addons/${encodeURIComponent(id)}`, { enabled }))
    .addon;
}
