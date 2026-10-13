/**
 * The admin match page (/manage/tournaments/:id/matches/:slug): everything it
 * shows in one read, and the Ready Up commands it sends.
 *
 * Every control on that page is one fleet command to the Ready Up plugin
 * running the match (FLEET.md, `cmd`), so nothing on it is a MatchZy-era
 * button that does nothing on a Ready Up server. Each command is written to
 * the match's event log with who sent it, so admins see each other's actions.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../config/database';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { getLiveState } from '../fleet/state';
import { fleetServerStatus, runFleetCommand } from '../fleet/driver';
import { fleetResponseBody, isFleetServer, issuedBy } from './fleetCommands';
import type { CmdName } from '../fleet/protocol/v1';

const router = Router();

/** The commands the page sends (FLEET.md §8.3). */
export const MANAGE_MATCH_COMMANDS: ReadonlySet<CmdName> = new Set<CmdName>([
  'pause',
  'unpause',
  'force_ready',
  'start',
  'restore_round',
  'restart_round',
  'restart_map',
  'change_map',
  'swap_teams',
  'kick',
  'say',
  'end',
  'exec',
]);

export type LogLevel = 'error' | 'warn' | 'info' | 'admin';

export interface ManageLogEntry {
  at: number;
  level: LogLevel;
  source: 'platform' | 'server' | 'admin';
  type: string;
  text: string;
  by: string | null;
}

/** One match_events row as a log line: its level, where it came from, and a short text. */
export function logEntryOf(row: {
  event_type: string;
  event_data: string;
  received_at: number;
}): ManageLogEntry {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.event_data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  const type = row.event_type;
  const byRaw = data.by;
  const by =
    byRaw && typeof byRaw === 'object' && 'name' in byRaw
      ? String((byRaw as { name: unknown }).name)
      : null;
  const level: LogLevel = by
    ? 'admin'
    : /error|fail/i.test(type)
      ? 'error'
      : /disconnect|warn|forfeit|timeout|crash/i.test(type)
        ? 'warn'
        : 'info';
  const source = by
    ? 'admin'
    : type.startsWith('fleet') || type.startsWith('event')
      ? 'server'
      : 'platform';
  const text =
    typeof data.text === 'string'
      ? data.text
      : typeof data.message === 'string'
        ? data.message
        : type.replace(/[_.]/g, ' ') +
          (typeof data.command === 'string' ? `: ${data.command}` : '') +
          (typeof data.reason === 'string' ? ` (${data.reason})` : '');
  return { at: Number(row.received_at), level, source, type, text, by };
}

/**
 * @openapi
 * /api/game/cs2/matches/{slug}/manage:
 *   get:
 *     tags: [Manage a match]
 *     summary: The admin match page's data (match, live state, server, event log)
 *     parameters:
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ match, server, live, log }" }
 *       401: { description: Not an admin }
 *       404: { description: No such match }
 */
/**
 * GET /api/game/cs2/matches/:slug/manage
 *
 * The match, its live state from the Ready Up server (teams with each
 * player's connection and ready, the round, pause, the maps and their rounds),
 * the server it runs on, and the match's event log, newest first.
 */
router.get('/matches/:slug/manage', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  try {
    const match = await db.queryOneAsync<{
      slug: string;
      status: string;
      server_id: string | null;
      tournament_id: number | null;
      round: number;
      match_number: number | null;
      team1_id: string | null;
      team2_id: string | null;
      t1: string | null;
      t2: string | null;
    }>(
      `SELECT m.slug, m.status, m.server_id, m.tournament_id, m.round, m.match_number,
              m.team1_id, m.team2_id, t1.name AS t1, t2.name AS t2
         FROM matches m
         LEFT JOIN teams t1 ON t1.id = m.team1_id
         LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE m.slug = ?`,
      [slug]
    );
    if (!match) return res.status(404).json({ success: false, error: 'Match not found' });

    const live = await getLiveState(slug);
    let server: {
      id: string;
      name: string | null;
      fleet: boolean;
      online: boolean | null;
      phase: string | null;
    } | null = null;
    if (match.server_id) {
      const row = await db.queryOneAsync<{ name: string | null }>(
        'SELECT name FROM cs2_servers WHERE id = ?',
        [match.server_id]
      );
      const fleet = await isFleetServer(match.server_id);
      const status = fleet ? await fleetServerStatus(match.server_id) : null;
      server = {
        id: match.server_id,
        name: row?.name ?? null,
        fleet,
        online: status ? status.online : null,
        phase: status?.phase ?? null,
      };
    }

    const rows = await db.queryAsync<{
      event_type: string;
      event_data: string;
      received_at: number;
    }>(
      `SELECT event_type, event_data, received_at FROM match_events
        WHERE match_slug = ? ORDER BY received_at DESC, id DESC LIMIT 300`,
      [slug]
    );

    return res.json({
      success: true,
      match: {
        slug: match.slug,
        status: match.status,
        tournamentId: match.tournament_id,
        round: match.round,
        matchNumber: match.match_number,
        team1: { id: match.team1_id, name: match.t1 },
        team2: { id: match.team2_id, name: match.t2 },
      },
      server,
      live: live
        ? { state: live.state, mapRounds: live.mapRounds, updatedAt: live.updatedAt }
        : null,
      log: rows.map(logEntryOf),
    });
  } catch (error) {
    log.error(`Error reading the manage view of ${slug}`, error as Error);
    return res.status(500).json({ success: false, error: 'Could not read the match' });
  }
});

/**
 * @openapi
 * /api/game/cs2/matches/{slug}/manage/command:
 *   post:
 *     tags: [Manage a match]
 *     summary: Send one Ready Up command to the match's server (logged with the admin)
 *     parameters:
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, enum: [pause, unpause, force_ready, start, restore_round, restart_round, restart_map, change_map, swap_teams, kick, say, end, exec] }
 *               args: { type: object }
 *     responses:
 *       200: { description: The server ran it }
 *       400: { description: Unknown command }
 *       409: { description: The match is not on a Ready Up server }
 */
/**
 * POST /api/game/cs2/matches/:slug/manage/command
 * Body: { name, args? }. Sends one Ready Up command to the match's server and
 * logs it with the admin who sent it.
 */
router.post('/matches/:slug/manage/command', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  const name = String(req.body?.name ?? '') as CmdName;
  const args =
    req.body?.args && typeof req.body.args === 'object'
      ? (req.body.args as Record<string, unknown>)
      : {};
  if (!MANAGE_MATCH_COMMANDS.has(name)) {
    return res.status(400).json({ success: false, error: `Unknown command: ${name}` });
  }
  try {
    const match = await db.queryOneAsync<{ server_id: string | null }>(
      'SELECT server_id FROM matches WHERE slug = ?',
      [slug]
    );
    if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
    if (!match.server_id || !(await isFleetServer(match.server_id))) {
      return res
        .status(409)
        .json({ success: false, error: 'The match is not on a Ready Up server' });
    }
    const who = issuedBy(req);
    const outcome = await runFleetCommand(match.server_id, name, args, who);
    await db
      .runAsync('INSERT INTO match_events (match_slug, event_type, event_data) VALUES (?, ?, ?)', [
        slug,
        'admin_command',
        JSON.stringify({
          command: name,
          args,
          result: outcome.status,
          by: { userId: who.userId, name: who.name },
        }),
      ])
      .catch((error: unknown) =>
        log.warn(`[MANAGE] ${slug}: command not logged`, { error: String(error) })
      );
    return res.status(outcome.ok ? 200 : outcome.httpStatus).json(fleetResponseBody(outcome));
  } catch (error) {
    log.error(`Error sending ${name} to ${slug}`, error as Error);
    return res.status(500).json({ success: false, error: 'Could not send the command' });
  }
});

export default router;
