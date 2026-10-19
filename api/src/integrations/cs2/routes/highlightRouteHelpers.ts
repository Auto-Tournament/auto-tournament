/** Helpers the highlight route files share (highlights.ts registers them in order). */
import { db } from '../../../config/database';

import { type Request, type Response } from 'express';
import { log } from '../../../utils/logger';
import { parseClipStarts } from '../demos/highlights';

import { RecorderError } from '../demos/recorders';

export const idOf = (req: Request) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A reel upload's `X-AT-Starts`, one per clip of its `X-AT-Clips`. */
export const startsOf = (req: Request, ids: number[] | null) =>
  ids ? parseClipStarts(req.headers['x-at-starts'], ids.length) : null;

/** A public read that answers 500 when the database fails, instead of hanging. */
export const read =
  (what: string, handler: (req: Request, res: Response) => Promise<Response | void>) =>
  async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      log.error(`[HIGHLIGHTS] ${what} failed`, { error, path: req.path });
      if (!res.headersSent)
        res.status(500).json({ success: false, error: `Could not read the ${what}` });
    }
  };

// Serialize claims from duplicate processes on one host, including benchmarks.
export const claimLock = async (
  req: Request,
  res: Response,
  next: import('express').NextFunction
) => {
  const name =
    typeof req.body?.recorder === 'string' ? req.body.recorder.slice(0, 120) : 'recorder';
  try {
    await db.withClient(async (client) => {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 125)) AS locked',
        [name]
      );
      if (!result.rows[0].locked) {
        res.status(204).end();
        return;
      }
      try {
        await new Promise<void>((resolve) => {
          res.once('finish', resolve);
          res.once('close', resolve);
          next();
        });
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 125))', [name]);
      }
    });
  } catch (error) {
    log.error('[RECORDER] claim lock failed', { error });
    if (!res.headersSent) res.status(500).json({ error: 'Could not lock recorder' });
  }
};

export const TWIN = ':twin(crowd|clean|overlay)';

export const recorderName = (req: Request): string =>
  typeof req.body?.recorder === 'string' && req.body.recorder ? req.body.recorder : 'recorder';

export function recorderFail(res: Response, error: unknown, what: string): Response {
  if (error instanceof RecorderError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  log.error(`[RECORDERS] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `Could not ${what}` });
}
