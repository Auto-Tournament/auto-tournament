/**
 * Slash commands (the Discord add-on): /matches and /mymatch. They
 * come over the bot's gateway connection (presence.ts), so nothing needs
 * setting up and the site needs no public address. An admin who sets the
 * app's Interactions Endpoint URL in the Discord Developer Portal gets them
 * at POST /api/addons/discord/interactions instead; both answer the same.
 *
 * The commands are registered on the picked server (guild commands show up at
 * once) when the add-on starts and when the server changes.
 */
import type { Request, Response } from 'express';
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import type { Untrusted } from '../../utils/untrusted';
import { matchNowPath } from '../../routes/players';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { verifyDiscordSignature } from './interactionVerify';

const COMMANDS = [
  { name: 'matches', description: 'The matches on a server right now' },
  { name: 'mymatch', description: 'Your match: where it is and how to join' },
];

const EPHEMERAL = 64;

/** The app's id and public key, from Discord (cached per token). */
let app: { token: string; id: string; publicKey: string } | null = null;

export async function appInfo(token: string): Promise<{ id: string; publicKey: string } | null> {
  if (app?.token === token) return app;
  const r = await discordFetch(token, '/oauth2/applications/@me');
  if (!r.ok || typeof r.body.id !== 'string' || typeof r.body.verify_key !== 'string') return null;
  app = { token, id: r.body.id, publicKey: r.body.verify_key };
  return app;
}

/** What the invite link asks for: Manage Channels, Manage Roles, Move Members, View Channels, Connect, Send Messages, Embed Links. */
const INVITE_PERMISSIONS = '286280720';

/** The link that adds the bot to a Discord server, with the permissions it needs. */
export function inviteUrl(appId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`;
}

/** Put /matches and /mymatch on the picked server. */
export async function registerCommands(): Promise<void> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  if (!token || !guildId) return;
  const info = await appInfo(token);
  if (!info) return;
  const r = await discordFetch(token, `/applications/${info.id}/guilds/${guildId}/commands`, {
    method: 'PUT',
    body: COMMANDS,
  });
  if (!r.ok) log.warn(`[Discord] Registering the slash commands failed: ${r.status}`);
}

const siteUrl = () => (process.env.FRONTEND_BASE_URL ?? '').trim().replace(/\/+$/, '');

async function matchesNow(): Promise<string> {
  const rows = await db.queryAsync<{
    slug: string;
    status: string;
    t1: string | null;
    t2: string | null;
  }>(
    `SELECT m.slug, m.status, t1.name AS t1, t2.name AS t2 FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.status IN ('loaded', 'live') ORDER BY m.loaded_at`
  );
  if (!rows.length) return 'No matches on a server right now.';
  return rows
    .map(
      (m) =>
        `**${m.t1 ?? 'TBD'}** vs **${m.t2 ?? 'TBD'}**: ${m.status === 'live' ? 'live' : 'ready'} ${siteUrl()}/match/${encodeURIComponent(m.slug)}`
    )
    .join('\n');
}

async function myMatch(discordUserId: string): Promise<string> {
  const player = await db.queryOneAsync<{ id: string }>(
    `SELECT COALESCE(
        (SELECT steam_id FROM auth_identities WHERE provider = 'discord' AND provider_user_id = ? ORDER BY id DESC LIMIT 1),
        (SELECT id FROM players WHERE discord_id = ? LIMIT 1)
      ) AS id`,
    [discordUserId, discordUserId]
  );
  if (!player?.id) {
    return 'I do not know your Steam account yet: sign in on the site with Discord, or ask an admin to add your Discord ID.';
  }
  const path = await matchNowPath(player.id);
  return path ? `Your match: ${siteUrl()}${path}` : 'You have no match right now.';
}

/** What a slash command answers (only the asker sees it). */
async function commandAnswer(interaction: Record<string, Untrusted>): Promise<string> {
  const data = interaction.data as Record<string, Untrusted> | undefined;
  const member = interaction.member as { user?: { id?: string }; permissions?: string } | undefined;
  const user = (interaction.user as { id?: string } | undefined) ?? member?.user;
  try {
    if (data?.name === 'matches') return await matchesNow();
    if (data?.name === 'mymatch' && user?.id) return await myMatch(user.id);
    return 'I do not know that command.';
  } catch (error) {
    log.warn('[Discord] A slash command failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Something went wrong; try again in a moment.';
  }
}

/**
 * A slash command that came over the gateway (presence.ts), which Discord uses
 * when no Interactions Endpoint URL is set: no public address needed. Answered
 * "thinking" at once (Discord allows 3 s), then with the text.
 */
export async function handleGatewayInteraction(
  interaction: Record<string, Untrusted>
): Promise<void> {
  if (interaction.type !== 2) return;
  const token = await botToken();
  const info = token ? await appInfo(token) : null;
  const id = typeof interaction.id === 'string' ? interaction.id : null;
  const answerToken = typeof interaction.token === 'string' ? interaction.token : null;
  if (!token || !info || !id || !answerToken) return;
  await discordFetch(token, `/interactions/${id}/${answerToken}/callback`, {
    method: 'POST',
    body: { type: 5, data: { flags: EPHEMERAL } },
  });
  const content = await commandAnswer(interaction);
  await discordFetch(token, `/webhooks/${info.id}/${answerToken}/messages/@original`, {
    method: 'PATCH',
    body: { content: content.slice(0, 2000), allowed_mentions: { parse: [] } },
  });
}

/** POST /api/addons/discord/interactions: the raw body (index.ts), checked against Discord's signature. */
export async function handleInteraction(req: Request, res: Response): Promise<Response> {
  const token = await botToken();
  const info = token ? await appInfo(token) : null;
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const ok =
    info !== null &&
    verifyDiscordSignature(
      info.publicKey,
      String(req.get('X-Signature-Ed25519') ?? ''),
      String(req.get('X-Signature-Timestamp') ?? ''),
      body
    );
  if (!ok) return res.status(401).send('invalid request signature');
  let interaction: Record<string, Untrusted>;
  try {
    interaction = JSON.parse(body.toString('utf8')) as Record<string, Untrusted>;
  } catch {
    return res.status(400).send('bad json');
  }
  // 1: Discord checking the endpoint.
  if (interaction.type === 1) return res.json({ type: 1 });
  const content = await commandAnswer(interaction);
  // 4: answer now; only the asker sees it.
  return res.json({
    type: 4,
    data: { content: content.slice(0, 2000), flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  });
}
