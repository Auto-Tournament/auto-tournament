/**
 * CS2 startup work and background jobs, run through `cs2Integration.start()`
 * and `stop()`.
 *
 * Servers are Ready Up servers on the fleet link: the fleet gateway, the host
 * agents and their background jobs start here.
 */

import { startRecorderRecovery, stopRecorderRecovery } from './demos/recorderRecovery';
import { startAutoStart } from './fleet/autoStart';
import { startVetoTimer, stopVetoTimer } from './veto/timer';
import { startWaitingSweep, stopWaitingSweep } from './waitingSweep';
import { startCs2AdminNotices, stopCs2AdminNotices } from './adminNotices';
import { startGameMessages, stopGameMessages } from './fleet/gameMessages';
import { startChatBridge, stopChatBridge } from './fleet/chatBridge';
import { log } from '../../utils/logger';
import { startMapAutoSync, stopMapAutoSync } from './maps/autoSync';
import { mapService } from './maps/mapService';
import { startFleet, stopFleet } from './fleet/service';
import { startFleetDriver } from './fleet/driver';
import { startRoundBackups, stopRoundBackups } from './fleet/backups';
import { startRestoreAudit, stopRestoreAudit } from './fleet/restore';
import { startDemoStreams, stopDemoStreams } from './fleet/demoStream';
import { startFleetHosts, stopFleetHosts } from './fleet/hosts/service';
import { recorderLink, startRecorderLink } from './demos/recorderLink';
import { startServerNotices, stopServerNotices } from './fleet/serverNotices';
import { startMovementRecords, stopMovementRecords } from './movement/records';
import { startFleetPush, stopFleetPush } from './fleet/push';
import { startFleetFailover, stopFleetFailover } from './fleet/failover';
import { startAutoscaler, stopAutoscaler } from './fleet/autoscale/scaler';
import { serverTurnoverTracker } from './utils/serverTurnover';
import { startFleetTopics } from './fleet/adminTopics';

let stopTurnoverRetry: (() => void) | null = null;

/**
 * A server whose turnover hold ends (its last demo upload reported back, or
 * the tracker gave up on it) gets the waiting matches right away: nothing
 * else fires then, since the server already reported itself available.
 */
function startTurnoverRetry(): void {
  if (stopTurnoverRetry) return;
  stopTurnoverRetry = serverTurnoverTracker.onRelease((serverId) => {
    log.debug(`[TURNOVER] Server ${serverId} released; retrying allocation`);
    setImmediate(() => {
      void import('../../core/scheduler')
        .then(({ scheduler }) => scheduler.tryImmediateAllocation())
        .catch((error) =>
          log.debug('[TURNOVER] allocation after release failed', {
            error: (error as Error).message,
          })
        );
    });
  });
}

export async function startCs2(): Promise<void> {
  startRecorderRecovery();
  // Round backups from Ready Up servers (event.backup) and the restore audit:
  // listening before the gateway takes its first message.
  startRoundBackups();
  startRestoreAudit();
  // Demos Ready Up servers stream over the fleet link (demo.*).
  startDemoStreams();
  // server.cs2_update_required / server.selftest from Ready Up servers.
  startServerNotices();
  // Surf / bhop / kz runs from Ready Up's movement plugin (movement.record).
  startMovementRecords();
  // Matches left in warmup start after the admin's limit (at_autostart_after_minutes).
  startAutoStart();
  // A veto step a team does not take in time is taken for them (veto_turn_seconds).
  startVetoTimer();
  // Ready matches still without a server get another try every 15 s.
  startWaitingSweep();
  // The admins' bell: crashed servers, failed updates, recorders, failing clips.
  startCs2AdminNotices();
  // The Servers page and match panels re-read on fleet changes (the `fleet` topic).
  startFleetTopics();
  // What the platform does to a match, told in game (next map, pauses, a crash recovered).
  startGameMessages();
  // The match chat to and from the game server (event.chat in, say out, admin call notices).
  startChatBridge();

  // The Ready Up fleet gateway (/api/fleet/ws) first: it only attaches to the
  // HTTP server, and servers reconnecting after a restart should not wait on
  // the RCON bootstrap below. The driver's hooks go in before it accepts a
  // hello (welcome.assignment, zombie unassigns, turnover, admin calls), and
  // so do the server-level pushes (admins.set, server.config, …).
  startFleetDriver();
  startTurnoverRetry();
  startFleetPush();
  await startFleet().catch((error) => {
    log.warn('Failed to start the fleet gateway', { error });
  });
  // csm host agents (/api/fleet/host, FLEET.md §18).
  await startFleetHosts().catch((error) => {
    log.warn('Failed to start the fleet host gateway', { error });
  });
  // Recorders' live link (/api/game/cs2/recorder/link): work is pushed to
  // them the moment it is queued, and they stream their progress.
  startRecorderLink();
  // Failover proposals for Ready Up servers that die mid-match (FLEET.md §11).
  startFleetFailover();
  // Automatic scaling of Ready Up servers on those machines (fleet/autoscale/).
  startAutoscaler();

  // Every map's type, for the tournament map-type rule (maps/mapModes.ts).
  await mapService.getAllMaps().catch((error) => {
    log.warn('Failed to read the map types on startup', { error });
  });

  // New maps and Active Duty changes from maps.json: now in the background, then daily.
  startMapAutoSync();
}

export function stopCs2(): void {
  stopRecorderRecovery();
  stopVetoTimer();
  stopCs2AdminNotices();
  stopGameMessages();
  stopChatBridge();
  stopWaitingSweep();
  stopMapAutoSync();
  stopFleet();
  stopTurnoverRetry?.();
  stopTurnoverRetry = null;
  stopRoundBackups();
  stopRestoreAudit();
  stopDemoStreams();
  stopFleetHosts();
  recorderLink.shutdown();
  stopFleetFailover();
  stopServerNotices();
  stopMovementRecords();
  stopFleetPush();
  stopAutoscaler();
}
