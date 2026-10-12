/**
 * "X is typing…": who is typing where, from the `chat:typing` socket event.
 * A sender says so at most every SEND_EVERY_MS while typing; a name shows
 * for SHOW_MS after its last event, or until that person's message comes.
 */

export const SEND_EVERY_MS = 2000;
export const SHOW_MS = 4000;

export interface Typist {
  playerId: string;
  name: string;
  /** When their last typing event came (ms). */
  at: number;
}

export type Typing = Record<string, Typist[]>;

/** Someone typed in a channel (again): first in, first shown. */
export function addTypist(
  typing: Typing,
  channel: string,
  who: Omit<Typist, 'at'>,
  now: number
): Typing {
  const list = typing[channel] ?? [];
  const known = list.some((t) => t.playerId === who.playerId);
  const next = known
    ? list.map((t) =>
        t.playerId === who.playerId ? { ...t, name: who.name || t.name, at: now } : t
      )
    : [...list, { ...who, at: now }];
  return { ...typing, [channel]: next };
}

/** Their message arrived: they are done typing. */
export function removeTypist(typing: Typing, channel: string, playerId: string | null): Typing {
  const list = typing[channel];
  if (!playerId || !list?.some((t) => t.playerId === playerId)) return typing;
  return { ...typing, [channel]: list.filter((t) => t.playerId !== playerId) };
}

/** Who is still typing in a channel now. */
export function typistsNow(typing: Typing, channel: string | null, now: number): Typist[] {
  if (!channel) return [];
  return (typing[channel] ?? []).filter((t) => now - t.at < SHOW_MS);
}

/** Whether to tell the server again (`last`: when we last did, ms). */
export function shouldSendTyping(last: number, now: number): boolean {
  return now - last >= SEND_EVERY_MS;
}

/** The line: one name, two names, or how many. */
export function typingLine(
  typists: Typist[],
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (typists.length === 0) return '';
  if (typists.length === 1) return t('chat.typing.one', { name: typists[0].name });
  if (typists.length === 2)
    return t('chat.typing.two', { first: typists[0].name, second: typists[1].name });
  return t('chat.typing.many', { count: typists.length });
}
