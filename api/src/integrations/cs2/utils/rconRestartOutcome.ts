/**
 * Classify the outcome of an RCON command that restarts the game server.
 *
 * `css_restart` makes the server restart before it answers, so the RCON reply
 * often never arrives and the client times out waiting for it. The command was
 * delivered and did its job, but it used to be reported as "Failed to end
 * match" — a false failure the admin could not act on.
 *
 * Kept free of imports so it can be tested without a database or a server.
 */

/** Commands whose side effect is restarting the server (and so dropping RCON). */
const SERVER_RESTART_COMMANDS = new Set(['css_restart']);

export function isServerRestartCommand(command: string): boolean {
  const name = command.trim().split(/\s+/)[0] ?? '';
  return SERVER_RESTART_COMMANDS.has(name.toLowerCase());
}

/**
 * Whether an RCON error means "the command was sent, the reply was lost".
 *
 * Only the command-reply timeout (`Rcon command "..." to host:port timed out
 * after Nms`) qualifies. In dathost-rcon-client that timer starts once the
 * command has been written to an authenticated socket, and a server that
 * restarts mid-reply leaves the send waiting until it fires — a socket closed
 * or reset after authentication surfaces as this same timeout.
 *
 * Everything else means the command never ran and stays a failure: a connect
 * timeout (`Rcon connect to ... timed out`), a refused or reset connection or
 * "unexpectedly ended" during the handshake, an unknown host, an
 * authentication error, and MAT's own 10s overall timeout (which also covers a
 * hung authentication handshake).
 */
export function isLostReplyError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return /^rcon command ".*" to \S+ timed out after/i.test(errorMessage.trim());
}
