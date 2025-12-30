---
title: What to do when something breaks
---

# What to do when something breaks

This guide gives you a **calm checklist** for common problems during a tournament in MatchZy Auto Tournament .
For deeper debugging steps, see [Troubleshooting](troubleshooting.md).

## 1. A player cannot connect

**Symptoms:** Player gets “Auth rejected” or cannot join the server.

Do this:

1. **Pause the match** from the match details view.
2. Confirm the player is on the correct **team roster** on the **Teams** page.
3. If you need a substitute, use **Add Backup Player** in the match admin controls.
4. Ask the player to reconnect.

If it still fails, your technical contact can check CS2 server logs and the MatchZy plugin.

## 2. The server is laggy or unplayable

**Symptoms:** Everyone reports lag, stutters, or high ping.

Do this:

1. **Pause the match** and tell teams you are investigating.
2. Check the **Servers** page to see if the server looks healthy.
3. If you have another server available, consider moving the match there.
4. Resume the match when both teams agree to continue.

For advanced recovery options (restoring from backups, replaying rounds), see [Match Recovery](match-recovery.md).

## 3. The match is stuck (warmup, veto, or no progress)

**Symptoms:** Warmup never ends, veto does not progress, or the match seems frozen.

Do this:

1. Open the **Matches** page and click the affected match.
2. Use admin controls such as:
   - **End Warmup** – if players are ready but the game is stuck.
   - **Skip Veto** – if veto is blocked and you are okay forcing a map.
   - **Restart Round / Restart Match** – as a last resort.
3. Inform teams clearly what you are doing before pressing these buttons.

If this happens often, your developer can review logs and server configuration.

## 4. Nothing is updating in the UI

**Symptoms:** Scores, brackets, or match status do not change even though games are played.

Do this:

1. Go to **Settings** and check that the **Webhook URL** is set to your **live domain** (for example `https://example.com`).
2. Confirm that your CS2 servers are using that same URL for webhooks and demo uploads.
3. Check the **Servers** page to ensure servers show as online.

If updates still do not appear, contact your technical contact or open an issue/Discord ticket with logs and screenshots.
