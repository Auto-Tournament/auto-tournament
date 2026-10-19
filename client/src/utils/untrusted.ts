/**
 * A value from outside the platform: a request body, a fetch response, a game
 * server or recorder message, a feed, a file someone uploaded. It is checked
 * once where it arrives (a schema or a small parser) and carries its real
 * type from then on.
 *
 * Values the platform makes or stores itself are never `Untrusted`: they have
 * a type. See the "Typed internals" rule in eslint.config.mjs.
 */
// eslint-disable-next-line no-restricted-syntax -- the one place `unknown` is named
export type Untrusted = unknown;

/** Whether an outside value is one of a list of allowed ones (`'a' | 'b'`), narrowing it if so. */
export function isOneOf<T extends string | number>(
  list: readonly T[],
  value: Untrusted
): value is T {
  return (list as readonly Untrusted[]).includes(value);
}
