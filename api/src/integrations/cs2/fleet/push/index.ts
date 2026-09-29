/**
 * Server-level pushes to Ready Up servers (FLEET.md §7.3-§7.5): the admin
 * list, server settings, whitelist / practice / plugins, and match.update
 * roster edits. Wired up with the fleet (../../startup.ts):
 *
 * - after every welcome: `admins.set` when the hello's `admins_rev` is not
 *   ours, `server.config` + `settings.set` when the server's last push is not
 *   the current settings rev; `plugins.set` for a new server csm created
 *   (the plugin set of its create) or one whose hello `plugins_state` differs
 *   from the set it was given (./pluginSets.ts);
 * - welcome's `admins_rev` / `server_config_rev` are the current revs;
 * - the admin list is re-read when the player service says it may have
 *   changed, and once a minute (a change made straight in the database);
 * - a `match.update` answered after its request stopped waiting still
 *   updates the stored match config.
 */

import { log } from '../../../../utils/logger';
import { onAdminListMaybeChanged } from '../../../../services/adminListEvents';
import { fleetInbound } from '../inbound';
import { onFleetServerReady, setFleetWelcomeRevs } from '../service';
import { adminsOnHello, syncAdmins } from './admins';
import { pluginsOnHello } from './controls';
import { applyAnsweredUpdate } from './matchUpdate';
import { settingsOnHello } from './settings';
import { readList } from './store';

const RESYNC_MS = 60_000;
/** Several admin changes in a row (a bulk edit) make one push. */
const DEBOUNCE_MS = 500;

let started = false;
let gatewayHooks = false;
let resyncTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
const unsubscribers: Array<() => void> = [];

function scheduleAdminSync(reason: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncAdmins(reason).catch((error) =>
      log.warn(`[FLEET] admin list sync failed: ${(error as Error).message}`)
    );
  }, DEBOUNCE_MS);
  debounceTimer.unref?.();
}

export function startFleetPush(): void {
  if (started) return;
  started = true;

  if (!gatewayHooks) {
    gatewayHooks = true;
    setFleetWelcomeRevs(async () => {
      const [admins, config] = await Promise.all([readList('admins'), readList('server_config')]);
      return { admins_rev: admins.rev, server_config_rev: config.rev };
    });

    onFleetServerReady(async (serverId, hello) => {
      try {
        await adminsOnHello(serverId, hello.admins_rev);
      } catch (error) {
        log.warn(`[FLEET] ${serverId}: admins.set after hello failed: ${(error as Error).message}`);
      }
      try {
        await settingsOnHello(serverId);
      } catch (error) {
        log.warn(`[FLEET] ${serverId}: settings after hello failed: ${(error as Error).message}`);
      }
      try {
        await pluginsOnHello(serverId, hello);
      } catch (error) {
        log.warn(`[FLEET] ${serverId}: plugins after hello failed: ${(error as Error).message}`);
      }
    });
  }

  unsubscribers.push(onAdminListMaybeChanged(() => scheduleAdminSync('admin users changed')));
  unsubscribers.push(
    fleetInbound.onCommandResult(({ command, result }) => {
      if (command?.type !== 'match.update') return;
      void applyAnsweredUpdate(command.id, result.status);
    })
  );

  resyncTimer = setInterval(() => scheduleAdminSync('periodic check'), RESYNC_MS);
  resyncTimer.unref?.();
  scheduleAdminSync('startup');
}

export function stopFleetPush(): void {
  if (resyncTimer) clearInterval(resyncTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  resyncTimer = null;
  debounceTimer = null;
  for (const off of unsubscribers.splice(0)) off();
  // The gateway listeners stay registered with the gateway (it has no
  // unregister); they are only called for sessions, and there are none after
  // stopFleet.
  started = false;
}
