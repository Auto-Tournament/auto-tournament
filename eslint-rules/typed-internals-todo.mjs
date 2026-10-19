/**
 * Files that still use `unknown` / `as unknown as` from before the "Typed
 * internals" rule (eslint.config.mjs). The rule skips them; every other file,
 * and every new one, must follow it. A fix PR removes its files from this
 * list; when it is empty, delete it.
 */
export const TYPED_INTERNALS_TODO = [];
