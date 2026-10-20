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
  return { ...status, guilds, guildId, channels, appId: app?.id ?? null, at: now() };
}

let refreshing: Promise<DiscordView> | null = null;

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
