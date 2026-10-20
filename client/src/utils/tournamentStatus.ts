/**
 * The two questions asked of a tournament's status all over the client, so
 * they are answered the same way everywhere. No imports: paths.ts uses it.
 */
type Status = string | null | undefined;

/** Running or over: the bracket and results exist. */
export function isStarted(status: Status): boolean {
  return status === 'in_progress' || status === 'completed';
}

/** Not started yet: being set up, or ready to start. */
export function isUpcoming(status: Status): boolean {
  return status === 'setup' || status === 'ready';
}
