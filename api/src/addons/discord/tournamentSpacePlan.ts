/**
 * When a tournament's space on the Discord server (tournamentSpace.ts) is
 * made and removed, kept apart from the database so it can be checked on its own.
 */

/** How long a finished tournament's space stays. */
export const KEEP_AFTER_S = 3 * 24 * 60 * 60;

/** Which spaces to make, keep and remove now (pure): running and recently finished stay. */
export function spacePlan(
  tournaments: Array<{ id: number; status: string; completedAt: number | null }>,
  spaces: number[],
  now: number
): { make: number[]; remove: number[] } {
  const keep = new Set(
    tournaments
      .filter(
        (t) =>
          t.status === 'in_progress' ||
          (t.status === 'completed' && (t.completedAt ?? now) > now - KEEP_AFTER_S)
      )
      .map((t) => t.id)
  );
  const running = tournaments.filter((t) => t.status === 'in_progress').map((t) => t.id);
  return {
    make: running.filter((id) => !spaces.includes(id)),
    remove: spaces.filter((id) => !keep.has(id)),
  };
}

/** The welcome DM (pure): the tournament's channels, the team's, and when the bot writes. */
export function welcomeText(
  tournament: string,
  ids: { chatId: string | null; lobbyId: string | null },
  site: string | null
): string {
  const ch = (id: string | null, name: string) => (id ? `<#${id}>` : name);
  return [
    '**Welcome to Auto Tournament!**',
    `You're playing in **${tournament}**, so you have its channels on this server now:`,
    `• ${ch(ids.chatId, '#chat')} is the tournament's channel: the start, announcements, and everyone playing.`,
    `• ${ch(ids.lobbyId, 'The Lobby')}: wait there, and you're moved into your team's voice when your match is ready.`,
    '• Your team has its own text and voice channel under "Your team". Each of your matches gets a card there, kept up to date from the veto to the result.',
    "I only DM you when you have something to do and you're not on the site: your veto turn, your match being ready, the tournament starting.",
    ...(site ? [`Change what you get: ${site}/me/connections`] : []),
  ].join('\n');
}

/** Discord holds this many channels in one category. */
export const CATEGORY_MAX = 50;

/** The first of these categories with room for `need` more channels, or null (pure). */
export function categoryWithRoom(
  categoryIds: string[],
  channels: Array<{ parentId: string | null }>,
  need: number
): string | null {
  return (
    categoryIds.find(
      (id) => channels.filter((c) => c.parentId === id).length + need <= CATEGORY_MAX
    ) ?? null
  );
}
