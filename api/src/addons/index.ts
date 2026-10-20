/**
 * The add-ons compiled into the platform (addons/types.ts).
 */
import { registerAddon } from './registry';
import { testAddon } from './testAddon';
import { hasIntegration } from '../integrations/registry';
import { discordAddon } from './discord';

registerAddon(discordAddon);
// Test runs only, on the same switch as the fake game integration.
if (hasIntegration('fake')) registerAddon(testAddon);

export {
  getAddon,
  isAddonRunning,
  listAddons,
  setAddonEnabled,
  startAddons,
  stopAddons,
} from './registry';
export type { AddonModule } from './types';
