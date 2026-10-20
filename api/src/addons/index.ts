/**
 * The add-ons compiled into the platform (addons/types.ts). The Discord bot
 * will be the first real one.
 */
import { registerAddon } from './registry';
import { testAddon } from './testAddon';
import { hasIntegration } from '../integrations/registry';

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
