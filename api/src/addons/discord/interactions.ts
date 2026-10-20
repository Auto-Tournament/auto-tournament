/**
 * Slash commands (the Discord add-on): /matches and /mymatch, answered over
 * Discord's Interactions Endpoint (POST /api/addons/discord/interactions), so
 * there is no gateway connection to keep up. The admin pastes that URL into
 * the app's settings in the Discord Developer Portal; it needs the site to be
 * reachable from the internet.
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
import { setupServer } from './setup';

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

const COMMANDS = [
  { name: 'matches', description: 'The matches on a server right now' },
  { name: 'mymatch', description: 'Your match: where it is and how to join' },
  {
    name: 'setup',
    description: 'Set up this server for Auto Tournament: category, #results and a Lobby',
    // Shown to the server's admins only; checked again when it runs.
    default_member_permissions: String(ADMINISTRATOR),
    dm_permission: false,
  },
];

const EPHEMERAL = 64;

/** The app's id and public key, from Discord (cached per token). */
let app: { token: string; id: string; publicKey: string } | null = null;

async function appInfo(token: string): Promise<{ id: string; publicKey: string } | null> {
  if (app?.token === token) return app;
  const r = await discordFetch(token, '/oauth2/applications/@me');
  if (!r.ok || typeof r.body.id !== 'string' || typeof r.body.verify_key !== 'string') return null;
  app = { token, id: r.body.id, publicKey: r.body.verify_key };
  return app;
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

async function setupCommand(permissions: string | undefined): Promise<string> {
  const perms = BigInt(permissions ?? '0');
  if ((perms & (ADMINISTRATOR | MANAGE_GUILD)) === 0n)
    return "Only the server's admins can do that.";
  try {
    await setupServer();
    return 'Done: the "Auto Tournament" category, #results for announcements, and a Lobby where players wait to be moved into their team\'s voice channel. When a tournament starts, its players get a DM with the Lobby link.';
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not set up the server.';
  }
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
  const data = interaction.data as Record<string, Untrusted> | undefined;
  const member = interaction.member as { user?: { id?: string }; permissions?: string } | undefined;
  const user = (interaction.user as { id?: string } | undefined) ?? member?.user;
  let content = 'I do not know that command.';
  try {
    if (data?.name === 'matches') content = await matchesNow();
    else if (data?.name === 'mymatch' && user?.id) content = await myMatch(user.id);
    else if (data?.name === 'setup') content = await setupCommand(member?.permissions);
  } catch (error) {
    log.warn('[Discord] A slash command failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    content = 'Something went wrong; try again in a moment.';
  }
  // 4: answer now; only the asker sees it.
  return res.json({
    type: 4,
    data: { content: content.slice(0, 2000), flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  });
}
