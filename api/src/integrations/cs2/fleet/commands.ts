/**
 * The platform's answered messages (`match.assign`, `match.update`,
 * `match.unassign`, `cmd`) and their one `cmd.result` each (Ready Up's
 * docs/fleet-step3-platform-notes.md §2): table `cs2_fleet_commands`
 * (migration 006). The outbox row of a message goes when the server acks it;
 * this row keeps what the server answered, correlated on the envelope `ref`.
 *
 * `./reliable.ts` records a command before it is sent; `./inbound.ts`
 * stores the answer and wakes whoever waits on it (`awaitCommandResult`).
 */

import { EventEmitter } from 'events';
import { db } from '../../../config/database';
import type { CmdResultPayload, CmdResultStatus } from './protocol/v1';

export type CommandStatus = 'pending' | CmdResultStatus;

export interface FleetCommandRecord {
  /** The envelope id; `cmd.result.ref`. */
  id: string;
  serverId: string;
  seq: number | null;
  type: string;
  matchSlug: string | null;
  epoch: number | null;
  /** `cmd` only: the command name. */
  name: string | null;
  status: CommandStatus;
  errorCode: string | null;
  result: CmdResultPayload | null;
  /** Unix seconds. */
  createdAt: number;
  answeredAt: number | null;
}

interface CommandRow {
  message_id: string;
  server_id: string;
  seq: number | null;
  type: string;
  match_slug: string | null;
  epoch: number | null;
  name: string | null;
  status: CommandStatus;
  error_code: string | null;
  result: string | null;
  created_at: number;
  answered_at: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);

function fromRow(row: CommandRow): FleetCommandRecord {
  let result: CmdResultPayload | null = null;
  try {
    result = row.result ? (JSON.parse(row.result) as CmdResultPayload) : null;
  } catch {
    result = null;
  }
  return {
    id: row.message_id,
    serverId: row.server_id,
    seq: row.seq === null ? null : Number(row.seq),
    type: row.type,
    matchSlug: row.match_slug,
    epoch: row.epoch === null ? null : Number(row.epoch),
    name: row.name,
    status: row.status,
    errorCode: row.error_code,
    result,
    createdAt: Number(row.created_at),
    answeredAt: row.answered_at === null ? null : Number(row.answered_at),
  };
}

const answers = new EventEmitter();
answers.setMaxListeners(0);

export async function recordCommand(input: {
  id: string;
  serverId: string;
  type: string;
  matchSlug: string | null;
  epoch: number | null;
  name: string | null;
}): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_commands (message_id, server_id, type, match_slug, epoch, name, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT (message_id) DO NOTHING`,
    [input.id, input.serverId, input.type, input.matchSlug, input.epoch, input.name, nowS()]
  );
}

export async function setCommandSeq(id: string, seq: number): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_commands SET seq = ? WHERE message_id = ?', [seq, id]);
}

/**
 * Store a `cmd.result` for the command `ref`. A replayed command answered
 * again overwrites the answer with the same one. Returns the updated record,
 * or null when `ref` is not a command of this server.
 */
export async function recordCommandResult(
  serverId: string,
  ref: string,
  payload: CmdResultPayload
): Promise<FleetCommandRecord | null> {
  const row = await db.queryOneAsync<CommandRow>(
    `UPDATE cs2_fleet_commands
        SET status = ?, error_code = ?, result = ?, answered_at = ?
      WHERE message_id = ? AND server_id = ?
      RETURNING *`,
    [payload.status, payload.error?.code ?? null, JSON.stringify(payload), nowS(), ref, serverId]
  );
  if (!row) return null;
  const record = fromRow(row);
  answers.emit(ref, record);
  return record;
}

export async function getCommand(id: string): Promise<FleetCommandRecord | null> {
  const row = await db.queryOneAsync<CommandRow>(
    'SELECT * FROM cs2_fleet_commands WHERE message_id = ?',
    [id]
  );
  return row ? fromRow(row) : null;
}

/** A match's commands, newest first. */
export async function listCommands(matchSlug: string, limit = 50): Promise<FleetCommandRecord[]> {
  const rows = await db.queryAsync<CommandRow>(
    'SELECT * FROM cs2_fleet_commands WHERE match_slug = ? ORDER BY created_at DESC, message_id DESC LIMIT ?',
    [matchSlug, limit]
  );
  return rows.map(fromRow);
}

/**
 * The answer to command `id`: resolves with the record once it is not
 * `pending` any more, or with null after `timeoutMs`. A command answered
 * before the call resolves at once.
 */
export async function awaitCommandResult(
  id: string,
  timeoutMs = 15_000
): Promise<FleetCommandRecord | null> {
  return new Promise<FleetCommandRecord | null>((resolve) => {
    let done = false;
    const finish = (record: FleetCommandRecord | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      answers.off(id, onAnswer);
      resolve(record);
    };
    const onAnswer = (record: FleetCommandRecord) => finish(record);
    const timer = setTimeout(() => finish(null), timeoutMs);
    answers.on(id, onAnswer);
    // Answered already (or while we subscribed)?
    void getCommand(id)
      .then((record) => {
        if (record && record.status !== 'pending') finish(record);
      })
      .catch(() => undefined);
  });
}
