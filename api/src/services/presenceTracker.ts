/**
 * Who is on the site right now, by player id: the signed-in sockets of each
 * player (several tabs, and several sockets per tab), and whether the tabs
 * that report it have gone idle.
 *
 * - online: at least one socket, and not every reporting socket is idle
 * - away: every socket that reported its idle state says idle (5 minutes
 *   without pointer, keyboard, focus or visibility in that tab)
 * - offline: no socket
 *
 * A socket that never reports (most of a tab's sockets: chat, social, topics)
 * keeps the player online but says nothing about idle. Kept apart from
 * socket.io so it can be tested on its own (socketService wires it in).
 */

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceChange {
  playerId: string;
  status: PresenceStatus;
  previous: PresenceStatus;
}

export class PresenceTracker {
  /** Player id → socket id → idle (null: has not said). */
  private readonly players = new Map<string, Map<string, boolean | null>>();
  /** Socket id → player id. */
  private readonly owners = new Map<string, string>();

  status(playerId: string): PresenceStatus {
    const sockets = this.players.get(playerId);
    if (!sockets || sockets.size === 0) return 'offline';
    let reported = false;
    for (const idle of sockets.values()) {
      if (idle === false) return 'online';
      if (idle === true) reported = true;
    }
    return reported ? 'away' : 'online';
  }

  /** Players with at least one socket. */
  onlineIds(): string[] {
    return [...this.players.keys()];
  }

  /** A player's socket subscribed. The change, if this made them online. */
  connect(playerId: string, socketId: string): PresenceChange | null {
    return this.change(playerId, () => {
      const previousOwner = this.owners.get(socketId);
      if (previousOwner && previousOwner !== playerId) this.drop(socketId);
      let sockets = this.players.get(playerId);
      if (!sockets) {
        sockets = new Map();
        this.players.set(playerId, sockets);
      }
      if (!sockets.has(socketId)) sockets.set(socketId, null);
      this.owners.set(socketId, playerId);
    });
  }

  /** A tab says it went idle or came back (connects the socket if it had not). */
  report(playerId: string, socketId: string, idle: boolean): PresenceChange | null {
    return this.change(playerId, () => {
      if (this.owners.get(socketId) !== playerId) {
        this.drop(socketId);
        this.owners.set(socketId, playerId);
      }
      let sockets = this.players.get(playerId);
      if (!sockets) {
        sockets = new Map();
        this.players.set(playerId, sockets);
      }
      sockets.set(socketId, idle);
    });
  }

  /** A socket closed. The change, if it was the player's last, or the last active one. */
  disconnect(socketId: string): PresenceChange | null {
    const playerId = this.owners.get(socketId);
    if (!playerId) return null;
    return this.change(playerId, () => this.drop(socketId));
  }

  private drop(socketId: string): void {
    const playerId = this.owners.get(socketId);
    if (!playerId) return;
    this.owners.delete(socketId);
    const sockets = this.players.get(playerId);
    sockets?.delete(socketId);
    if (sockets && sockets.size === 0) this.players.delete(playerId);
  }

  private change(playerId: string, mutate: () => void): PresenceChange | null {
    const previous = this.status(playerId);
    mutate();
    const status = this.status(playerId);
    return status === previous ? null : { playerId, status, previous };
  }
}
