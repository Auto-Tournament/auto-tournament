/**
 * The add-on modules' pages in the client (the API side is api/src/addons):
 * an add-on with settings registers the page Modules → <add-on> shows. The
 * Discord bot is the first.
 */
import type { ComponentType } from 'react';

export interface ClientAddon {
  id: string;
  /** Its page under Modules (/manage/modules/<id>). */
  Page: ComponentType;
}

const addons = new Map<string, ClientAddon>();

export function registerClientAddon(addon: ClientAddon): void {
  addons.set(addon.id, addon);
}

export function clientAddon(id: string): ClientAddon | undefined {
  return addons.get(id);
}
