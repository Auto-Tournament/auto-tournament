/**
 * What Modules → Discord bot shows from Discord (the bot's name, its servers,
 * the picked server's channels, the app id), kept in the database so the page
 * answers at once. Reading it from Discord takes a few calls through the rate
 * limit queue (about 4 s). A snapshot older than STALE_S is refreshed in the
 * background; a change the admin makes (token, server, Set up) refreshes it
 * before answering.
 */
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { botToken, discordBot, pickedGuildId } from './bot';
import { appInfo } from './interactions';
import { discordFetch } from './rest';
import { missingPermissions } from './permissions';
import { adminNoticeService } from '../../services/adminNoticeService';
import type { Untrusted } from '../../utils/untrusted';

const KEY = 'discord_snapshot';
const STALE_S = 30;

export interface DiscordView {
  set: boolean;
  name: string | null;
  guilds: Array<{ id: string; name: string }>;
  /** The server it was read for; another server picked since means read again. */
  guildId: string | null;
  channels: Array<{ id: string; name: string; type: number }>;
  appId: string | null;
  /** Permissions the bot needs and lacks on the picked server (permissions.ts). */
  missing?: string[];
  at: number;
}

const now = () => Math.floor(Date.now() / 1000);

async function readFromDiscord(): Promise<DiscordView> {
  const status = await discordBot.status();
  const token = status.set ? await botToken() : null;
  const app = token ? await appInfo(token) : null;
  const { guilds, guildId } = status.set
    ? await discordBot.guilds()
    : { guilds: [], guildId: null };
  const channels = guildId ? await discordBot.channels([0, 2, 4, 5]) : [];
  const missing = token && guildId ? await missingOn(token, guildId) : [];
  return { ...status, guilds, guildId, channels, appId: app?.id ?? null, missing, at: now() };
}

/** What the bot lacks on its server; admins are told (Needs you) until it has it all. */
async function missingOn(token: string, guildId: string): Promise<string[]> {
  const me = await discordFetch(token, '/users/@me');
  const member =
    typeof me.body.id === 'string'
      ? await discordFetch(token, `/guilds/${guildId}/members/${me.body.id}`)
      : null;
  const roles = await discordFetch(token, `/guilds/${guildId}/roles`);
  if (!member?.ok || !Array.isArray(roles.body)) return [];
  const missing = missingPermissions(
    guildId,
    Array.isArray(member.body.roles) ? (member.body.roles as string[]) : [],
    (roles.body as Array<Record<string, Untrusted>>).map((r) => ({
      id: String(r.id),
      permissions: String(r.permissions ?? '0'),
    }))
  );
  if (missing.length) {
    await adminNoticeService.raise(
      'discord_failed',
      {
        what: 'Discord bot permissions',
        detail: `Missing ${missing.join(', ')}. Open Modules → Discord bot and click Invite to a server: it updates the bot's permissions without removing it.`,
      },
      'discord_permissions',
      undefined,
      { ongoing: true }
    );
  } else {
    await adminNoticeService.resolve('discord_permissions');
  }
  return missing;
}

let refreshing: Promise<DiscordView> | null = null;

let checkTimer: NodeJS.Timeout | null = null;

/** Read it again now and every half hour, so a missing permission reaches the admins (Needs you). */
export function startPermissionCheck(): void {
  if (checkTimer) return;
  checkTimer = setInterval(() => void refreshView().catch(() => undefined), 30 * 60 * 1000);
  checkTimer.unref();
  void refreshView().catch(() => undefined);
}

export function stopPermissionCheck(): void {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
}

/** Read it from Discord now and store it (one read at a time). */
export function refreshView(): Promise<DiscordView> {
  refreshing ??= readFromDiscord()
    .then(async (view) => {
      await db.setAppSettingAsync(KEY, JSON.stringify(view));
      return view;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** The stored snapshot, and whether a newer one is on its way. */
export async function currentView(): Promise<{ view: DiscordView; stale: boolean }> {
  let stored: DiscordView | null = null;
  try {
    stored = JSON.parse((await db.getAppSettingAsync(KEY)) ?? 'null') as DiscordView | null;
  } catch {
    stored = null;
  }
  // None yet, or for another server: nothing right to show, so wait for Discord.
  const picked = await pickedGuildId();
  if (stored?.guildId !== picked) return { view: await refreshView(), stale: false };
  if (now() - stored.at < STALE_S) return { view: stored, stale: false };
  void refreshView().catch((error) => {
    log.warn('[Discord] Refreshing the bot page failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return { view: stored, stale: true };
}
