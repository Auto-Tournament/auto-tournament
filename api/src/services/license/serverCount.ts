import { log } from '../../utils/logger';

/**
 * Game servers set up across the installed integrations (CS2: enabled
 * servers). Null when none can count them or counting failed.
 */
export async function countServers(): Promise<number | null> {
  const { listIntegrations } = await import('../../integrations/registry');
  let total = 0;
  let counted = false;
  for (const integration of listIntegrations()) {
    if (!integration.configuredResourceCount) continue;
    try {
      total += await integration.configuredResourceCount();
      counted = true;
    } catch (error) {
      log.warn(`[LICENSE] Could not count ${integration.id} servers`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return counted ? total : null;
}
