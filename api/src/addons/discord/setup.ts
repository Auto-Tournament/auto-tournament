/**
 * "Set up this server" (Modules → Discord): what the bot needs on the picked
 * Discord server, made in one click and reused when it is there already.
 *
 * - an "Auto Tournament" category;
 * - #results in it, for the match announcements (the whole server reads it;
 *   it pings no one).
 *
 * Each tournament gets its own category when it starts, for its players only,
 * with its Lobby and team channels (tournamentSpace.ts). It fills in the
 * category and the announcement channel and turns the team voice channels on.
 * It never deletes or renames what the admin made (a Lobby an older setup
 * made stays, and is used when a tournament has no category of its own).
 */
import type { Untrusted } from '../../utils/untrusted';
import { announceChannel, setAnnounceChannel } from './announce';
import { botToken, pickedGuildId } from './bot';
import { setVoiceSettings, voiceSettings } from './matchVoice';
import { discordFetch } from './rest';

const CATEGORY = 'Auto Tournament';
const RESULTS = 'results';

interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
}

export class SetupError extends Error {}

/** The category and #results the bot uses, as stored (null: none yet). */
async function storedIds() {
  return {
    category: (await voiceSettings()).categoryId,
    results: await announceChannel(),
  };
}

/** Which of them are on the server now (renamed counts; deleted does not). */
export async function setupState(
  channels: Array<{ id: string; type: number }>
): Promise<{ category: boolean; results: boolean }> {
  const ids = await storedIds();
  const there = (id: string | null, types: number[]) =>
    id !== null && channels.some((c) => c.id === id && types.includes(c.type));
  return {
    category: there(ids.category, [4]),
    results: there(ids.results, [0, 5]),
  };
}

export async function setupServer(): Promise<{ categoryId: string; resultsId: string }> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  if (!token || !guildId) throw new SetupError('Pick the Discord server first');
  const listed = await discordFetch(token, `/guilds/${guildId}/channels`);
  if (!listed.ok || !Array.isArray(listed.body)) {
    throw new SetupError(`Discord did not list the channels (${listed.status})`);
  }
  const channels = (listed.body as Array<Record<string, Untrusted>>).map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ''),
    type: Number(c.type),
    parent_id: typeof c.parent_id === 'string' ? c.parent_id : null,
  }));

  const stored = await storedIds();
  // The one it made before (even renamed), else one with the name, else a new one.
  const ensure = async (
    want: Omit<Channel, 'id'>,
    storedId: string | null,
    extra: Record<string, Untrusted> = {}
  ) => {
    if (storedId && channels.some((c) => c.id === storedId && c.type === want.type))
      return storedId;
    const found = channels.find(
      (c) =>
        c.type === want.type &&
        c.name.toLowerCase() === want.name.toLowerCase() &&
        (want.type === 4 || c.parent_id === want.parent_id)
    );
    if (found) return found.id;
    const made = await discordFetch(token, `/guilds/${guildId}/channels`, {
      method: 'POST',
      body: {
        name: want.name,
        type: want.type,
        ...(want.parent_id ? { parent_id: want.parent_id } : {}),
        ...extra,
      },
    });
    if (!made.ok || typeof made.body.id !== 'string') {
      throw new SetupError(
        `Could not make ${want.name}: Discord answered ${made.status} (does the bot have Manage Channels and Manage Roles?)`
      );
    }
    return made.body.id;
  };

  const categoryId = await ensure({ name: CATEGORY, type: 4, parent_id: null }, stored.category);
  const resultsId = await ensure({ name: RESULTS, type: 0, parent_id: categoryId }, stored.results);

  await setVoiceSettings({ enabled: true, categoryId });
  await setAnnounceChannel(resultsId);
  return { categoryId, resultsId };
}
