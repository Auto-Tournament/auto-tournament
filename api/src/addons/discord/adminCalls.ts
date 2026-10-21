/**
 * Admin calls on Discord (the Discord add-on): when a player calls for an
 * admin from a game server, each admin who is not on the site (where the call
 * shows as a toast) gets a DM: who called, what they said, the match, the
 * server, a link to the match page and to the caller's team channel.
 */
import { db } from '../../config/database';
import type { AdminCall } from '../../types/adminCall.types';
import { presenceStatus } from '../../services/socketService';
import { discordIdOf } from '../../services/notifyChannels';
import { discordBot } from './bot';
import { adminCallText } from './adminCallText';

const siteUrl = () => (process.env.FRONTEND_BASE_URL ?? '').trim().replace(/\/+$/, '') || null;

export async function dmAdminsAboutCall(call: AdminCall): Promise<void> {
  const side =
    call.player.team === 'team1' || call.player.team === 'team2' ? call.player.team : null;
  const team =
    side && call.matchSlug
      ? await db.queryOneAsync<{ channel_id: string }>(
          `SELECT c.channel_id FROM matches m
             JOIN discord_team_channels c ON c.tournament_id = m.tournament_id
              AND c.team_id = CASE WHEN ? = 'team1' THEN m.team1_id ELSE m.team2_id END
            WHERE m.slug = ?`,
          [side, call.matchSlug]
        )
      : null;
  const text = adminCallText(call, siteUrl(), team?.channel_id ?? null);
  const admins = await db.queryAsync<{ id: string }>(
    'SELECT id FROM players WHERE is_admin = 1 AND deleted_at IS NULL'
  );
  for (const { id } of admins) {
    // On the site the call is a toast already.
    if (presenceStatus(id) === 'online') continue;
    const discordId = await discordIdOf(id);
    if (discordId) await discordBot.sendDm(discordId, text);
  }
}
