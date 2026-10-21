/** What the admin-call DM says (adminCalls.ts), kept apart from the database so it can be checked on its own. */
import type { AdminCall } from '../../types/adminCall.types';

/** The DM (pure). */
export function adminCallText(
  call: AdminCall,
  site: string | null,
  teamChannelId: string | null
): string {
  const who = call.player.name ?? 'A player';
  const team = call.player.teamName ? ` (${call.player.teamName})` : '';
  const match = call.team1Name && call.team2Name ? `${call.team1Name} vs ${call.team2Name}` : null;
  return [
    `**${who}${team} is calling for an admin**`,
    call.message ? `"${call.message}"` : null,
    [match, call.mapNumber !== null ? `map ${call.mapNumber + 1}` : null, call.serverName]
      .filter(Boolean)
      .join(' · ') || null,
    site && call.matchSlug ? `Match: ${site}/match/${encodeURIComponent(call.matchSlug)}` : null,
    teamChannelId ? `Team channel: <#${teamChannelId}>` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
