/**
 * `player.config` (server → platform): a player's CS2 config as their game reported it to Ready
 * Up's playersettings plugin (the crosshair code and cvar answers), read once per map. Kept for
 * the profile's Config tab (playerConfig.ts) unless the player turned it off.
 *
 * The server says who the player is (its fleet link is authenticated); the values are checked
 * against the list the profile shows.
 */

import { log } from '../../../utils/logger';
import { cleanCode, cleanCvars, playerConfigService } from '../playerConfig';
import { registerInboundHandler, type InboundContext } from './inbound';
import type { Envelope, PlayerConfigPayload } from './protocol/v1';

async function onConfig(
  ctx: InboundContext,
  env: Envelope<string, PlayerConfigPayload>
): Promise<void> {
  const { steamid64 } = env.payload;
  const cvars = cleanCvars(env.payload.cvars);
  const code = cleanCode(env.payload.crosshair_code);
  const kept = await playerConfigService.ingest(steamid64, code, cvars);
  log.debug(
    `[FLEET] ${ctx.serverId}: config for ${steamid64}: ${Object.keys(cvars).length} cvar(s)${code ? ' + crosshair' : ''}${kept ? '' : ' (not kept)'}`
  );
}

let unregister: Array<() => void> = [];

export function startPlayerConfig(): void {
  if (unregister.length) return;
  unregister = [registerInboundHandler('player.config', { handle: onConfig })];
}

export function stopPlayerConfig(): void {
  for (const off of unregister) off();
  unregister = [];
}
