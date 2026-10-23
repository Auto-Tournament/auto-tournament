# Recorder controls and recovery

On **Manage → Highlights → CS2 → Recorders**, recorders are sorted by name. Each group shows separate connected and enabled counts. Expand a recorder for its details and recent runs. A red name means its latest completed run failed; the next successful run clears it.

Disable a group to stop its recorders claiming new work. Their individual switches remain set, but cannot be changed while the group is disabled. Existing jobs finish first. Disabling one recorder also drains its current job.

For an immediate stop, first disable the group in AT, then run `docker stop at-recorder` on the affected recorder host. This stops its game and capture processes. Re-enable the group only when the hosts are ready. Starting the container again preserves its mounted Steam state and CS2 installation.

## Repeat a match recording

Open the imported match in the Highlights clips list, select its recording group, then choose **Redo all clips**. Completed and failed clips are queued again; active clips are left alone. Map and series reels wait for the new clips. Keep unrelated recorders disabled during a controlled fleet test.

## Retry policy

A failed attempt gives the original recorder one retry, reserved for 90 seconds. After its second failure, another eligible recorder in the selected group is preferred. Three failed attempts mark the job failed. A recorder with repeated game-start faults is temporarily paused.

Workers heartbeat every five minutes. An attempt with no heartbeat for twelve minutes is recovered, and an attempt has a maximum lifetime of 3 hours even if it keeps heartbeating (frame by frame renders as slowly as the GPU needs). AT checks abandoned attempts every minute, including when all recorders have disconnected. Pending work still needs an enabled, connected recorder to finish.

Updated workers use an attempt token, so requests from an expired attempt are rejected. AT also serializes claims per recorder and prevents it taking a second job while it holds work. Upgrade existing workers after they drain to use the new attempt protocol.

The platform includes update controls and host-agent registration support. Updates become available only after a compatible host agent reports an installed image and a newer build exists. The native installer and host updater are being delivered in a later phase.
