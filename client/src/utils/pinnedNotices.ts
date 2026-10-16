/**
 * Notices pinned to the top of the bell until the player acts on them (CS2: a
 * skin to pick). A module renders its own rows in the bell (`pinnedNotices`
 * slot) and names them here, so the bell's badge counts them. "Mark all read"
 * clears them from the badge (the rows stay); a new one counts again.
 */
import { useSyncExternalStore } from 'react';

const READ_KEY = 'at.pinnedNoticesRead';
const byOwner = new Map<string, string[]>();
const listeners = new Set<() => void>();
let unread = 0;

function loadRead(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
let read = loadRead();

function saveRead(): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...read]));
  } catch {
    // Private window: the badge clears for this page load only.
  }
}

function all(): string[] {
  return [...byOwner.entries()].flatMap(([owner, ids]) => ids.map((id) => `${owner}:${id}`));
}

function update(): void {
  unread = all().filter((id) => !read.has(id)).length;
  listeners.forEach((l) => l());
}

/** The pinned notices `owner` (a module id) has now, by their own ids; [] clears them. */
export function setPinnedNotices(owner: string, ids: Array<string | number>): void {
  const next = ids.map(String);
  const prev = byOwner.get(owner) ?? [];
  if (prev.length === next.length && prev.every((id, i) => id === next[i])) return;
  if (next.length === 0) byOwner.delete(owner);
  else byOwner.set(owner, next);
  // Forget read marks for notices that are gone (picked), so the list stays small.
  const live = new Set(all());
  const before = read.size;
  read = new Set([...read].filter((id) => live.has(id) || !id.startsWith(`${owner}:`)));
  if (read.size !== before) saveRead();
  update();
}

/** "Mark all read": the pinned notices on show stop counting in the badge. */
export function markPinnedNoticesRead(): void {
  all().forEach((id) => read.add(id));
  saveRead();
  update();
}

/** Pinned notices not marked read, for the bell's badge. */
export function usePinnedNoticeCount(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => unread
  );
}
