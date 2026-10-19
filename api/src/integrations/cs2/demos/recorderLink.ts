/**
 * The recorder link: `/api/game/cs2/recorder/link`, one WebSocket per
 * recorder, which it keeps open to the platform (it connects out, so it works
 * from any LAN). The platform is the orchestrator: it tells a recorder the
 * moment there is work, and the recorder streams what it is doing.
 *
 * The database stays the truth. Claims, leases, retries, benchmarks and
 * updates are the same rows the HTTP routes use; the link only takes the
 * waiting out (a `wake` instead of the next poll) and carries progress. A
 * message lost with a dropped link costs nothing: the recorder still polls,
 * slowly, and leases recover a job whose recorder went away.
 *
 * Auth: `Authorization: Bearer atr_…` (a recorder key) on the upgrade; a bad
 * key gets the handshake and close code 4401.
 *
 * Recorder → platform (JSON):
 *   { type: 'hello', recorder, version }        first, within 10 s
 *   { type: 'progress', … }                     what it is doing (see Progress)
 *   { type: 'idle' }                            nothing to do
 * Platform → recorder:
 *   { type: 'welcome', heartbeatMs }
 *   { type: 'wake' }                            there may be work: claim now
 *   { type: 'cancel' }                          stop the current job
 *
 * Progress goes to admins on the Recorders page (`recorders:progress`) and,
 * for a match's clips and reels, to its public page
 * (`highlights:progress:<slug>`: the recorder's name, what and how far; no
 * more than the page already shows).
 */

import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { maybeIO, ADMIN_ROOM } from '../../../services/socketService';
import { checkRecorderKey } from './recorderKeys';
import { recordingWaiting } from './recorderLeases';
import type { Untrusted } from '../../../utils/untrusted';

export const RECORDER_LINK_PATH = '/api/game/cs2/recorder/link';
export const LINK_HEARTBEAT_MS = 10_000;
const LINK_DEAD_MS = 30_000;
const HELLO_TIMEOUT_MS = 10_000;
const MAX_FRAME = 16 * 1024;
const SEEN_WRITE_MS = 10_000;
const SWEEP_MS = 15_000;
const CLOSE = { BAD_KEY: 4401, BAD_HELLO: 4400, REPLACED: 4409, DRAINING: 4503 } as const;

/** What a recorder is doing, as it says. */
export interface RecorderProgress {
  /** recording | encoding | uploading | joining | redressing | benchmark | starting | waiting */
  step: string;
  /** "ZywOo · 4K · round 7", "Map reel", "csrender3 benchmark". */
  detail?: string;
  /** The job: a map's clips, a reel. */
  matchSlug?: string;
  mapNumber?: number;
  /** Which clip of how many (a map job), and how far this step is, 0–100. */
  done?: number;
  total?: number;
  percent?: number;
  /** Seconds the job has run, and its estimate. */
  elapsed?: number;
  eta?: number;
  /** Server time it was received. */
  at: number;
}

class LinkSession {
  name: string | null = null;
  version = 0;
  private lastFrame = Date.now();
  private lastSeenWrite = 0;
  private timer: NodeJS.Timeout;

  constructor(
    link: RecorderLink,
    readonly ws: WebSocket,
    auth: Promise<boolean>
  ) {
    const hello = setTimeout(() => this.close(CLOSE.BAD_HELLO, 'no hello'), HELLO_TIMEOUT_MS);
    this.timer = setInterval(() => {
      if (Date.now() - this.lastFrame > LINK_DEAD_MS) {
        ws.terminate();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, LINK_HEARTBEAT_MS);
    ws.on('pong', () => this.seen());
    ws.on('close', () => {
      clearTimeout(hello);
      clearInterval(this.timer);
      link.unregister(this);
    });
    ws.on('error', () => undefined);
    void auth.then((ok) => {
      if (!ok) {
        clearTimeout(hello);
        this.close(CLOSE.BAD_KEY, 'invalid or revoked recorder key');
        return;
      }
      ws.on('message', (data: RawData, isBinary: boolean) => {
        this.seen();
        if (isBinary) return;
        const text = data.toString();
        if (text.length > MAX_FRAME) return;
        let msg: Record<string, Untrusted>;
        try {
          msg = JSON.parse(text) as Record<string, Untrusted>;
        } catch {
          return;
        }
        if (!this.name) {
          if (msg.type !== 'hello' || !validName(msg.recorder)) {
            this.close(CLOSE.BAD_HELLO, 'the first message is hello');
            return;
          }
          clearTimeout(hello);
          this.name = msg.recorder as string;
          this.version = Number(msg.version) || 0;
          link.register(this);
          this.send({ type: 'welcome', heartbeatMs: LINK_HEARTBEAT_MS });
          return;
        }
        if (msg.type === 'progress') link.progress(this.name, msg);
        else if (msg.type === 'idle') link.idle(this.name);
      });
    });
  }

  private seen(): void {
    this.lastFrame = Date.now();
    if (!this.name || Date.now() - this.lastSeenWrite < SEEN_WRITE_MS) return;
    this.lastSeenWrite = Date.now();
    void db
      .runAsync('UPDATE cs2_recorders SET last_seen = ? WHERE name = ?', [
        Math.floor(Date.now() / 1000),
        this.name,
      ])
      .catch(() => undefined);
  }

  send(msg: object): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(code: number, reason: string): void {
    try {
      this.ws.close(code, reason);
    } catch {
      this.ws.terminate();
    }
  }
}

function validName(v: Untrusted): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

const num = (v: Untrusted, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
const str = (v: Untrusted, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** A progress message, checked: only what the pages show, bounded. */
export function parseProgress(
  msg: Record<string, Untrusted>,
  at = Date.now()
): RecorderProgress | null {
  const step = str(msg.step, 24);
  if (!step || !/^[a-z-]+$/.test(step)) return null;
  const matchSlug = str(msg.matchSlug, 120);
  return {
    step,
    detail: str(msg.detail, 120),
    matchSlug: matchSlug && /^[A-Za-z0-9_.-]+$/.test(matchSlug) ? matchSlug : undefined,
    mapNumber: num(msg.mapNumber, -1, 20),
    done: num(msg.done, 0, 1000),
    total: num(msg.total, 0, 1000),
    percent: num(msg.percent, 0, 100),
    elapsed: num(msg.elapsed, 0, 86_400),
    eta: num(msg.eta, 0, 86_400),
    at,
  };
}

export class RecorderLink {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  private readonly sessions = new Map<string, LinkSession>();
  private readonly connections = new Set<LinkSession>();
  private readonly latest = new Map<string, RecorderProgress>();
  private server: HttpServer | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private changedTimer: NodeJS.Timeout | null = null;

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== RECORDER_LINK_PATH) return;
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
        ? header.slice(7).trim()
        : '';
    const auth = token
      ? checkRecorderKey(token)
          .then((k) => !!k)
          .catch(() => false)
      : Promise.resolve(false);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.connections.add(new LinkSession(this, ws, auth));
    });
  };

  attach(server: HttpServer): void {
    if (this.server === server) return;
    this.detach();
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    // Work that becomes claimable without anyone queueing it (a retry's
    // wait ends, a lease expires): wake idle recorders when there is some.
    this.sweep = setInterval(() => void this.sweepWork(), SWEEP_MS);
    log.info(`[RECORDER-LINK] listening on ${RECORDER_LINK_PATH}`);
  }

  detach(): void {
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = null;
    if (!this.server) return;
    this.server.off('upgrade', this.onUpgrade);
    this.server = null;
  }

  shutdown(): void {
    this.detach();
    for (const s of this.connections) s.close(CLOSE.DRAINING, 'platform restarting');
  }

  /** @internal */
  register(session: LinkSession): void {
    const name = session.name!;
    const previous = this.sessions.get(name);
    this.sessions.set(name, session);
    if (previous && previous !== session)
      previous.close(CLOSE.REPLACED, 'replaced by a newer link');
    log.info(`[RECORDER-LINK] ${name} linked (protocol ${session.version})`);
    emitAdmin('recorders:changed', { name });
    // It may have been waiting for exactly this: look for work now.
    session.send({ type: 'wake' });
  }

  /** @internal */
  unregister(session: LinkSession): void {
    this.connections.delete(session);
    const name = session.name;
    if (!name || this.sessions.get(name) !== session) return;
    this.sessions.delete(name);
    const before = this.latest.get(name);
    if (before?.matchSlug) clearPublic(name, before.matchSlug);
    this.latest.delete(name);
    log.info(`[RECORDER-LINK] ${name} unlinked`);
    emitAdmin('recorders:changed', { name });
  }

  /** @internal */
  progress(name: string, msg: Record<string, Untrusted>): void {
    const p = parseProgress(msg);
    if (!p) return;
    const before = this.latest.get(name);
    if (before?.matchSlug && before.matchSlug !== p.matchSlug) clearPublic(name, before.matchSlug);
    this.latest.set(name, p);
    emitAdmin('recorders:progress', { name, progress: p });
    if (p.matchSlug) {
      maybeIO()?.emit(`highlights:progress:${p.matchSlug}`, {
        recorder: name,
        step: p.step,
        detail: p.detail ?? null,
        mapNumber: p.mapNumber ?? null,
        done: p.done ?? null,
        total: p.total ?? null,
        percent: p.percent ?? null,
      });
    }
  }

  /** @internal */
  idle(name: string): void {
    const before = this.latest.get(name);
    if (!this.latest.delete(name)) return;
    if (before?.matchSlug) clearPublic(name, before.matchSlug);
    emitAdmin('recorders:progress', { name, progress: null });
  }

  /**
   * A recorder's update, from its host agent (POST /recorder/update): its
   * step while it runs, nothing once it is current or failed. Any status
   * change re-reads the Recorders page.
   */
  updateProgress(name: string, step: string | null, status: string): void {
    if (status === 'updating') {
      const p: RecorderProgress = { step: 'updating', detail: step ?? undefined, at: Date.now() };
      this.latest.set(name, p);
      emitAdmin('recorders:progress', { name, progress: p });
    } else if (this.latest.get(name)?.step === 'updating') {
      this.latest.delete(name);
      emitAdmin('recorders:progress', { name, progress: null });
    }
    emitAdmin('recorders:changed', { name });
  }

  /** Something about the recorders changed: the Recorders page reads them again (bursts folded). */
  changed(): void {
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null;
      emitAdmin('recorders:changed', {});
    }, 500);
  }

  /** The recorders with a live link. */
  linked(): Set<string> {
    return new Set(this.sessions.keys());
  }

  /** What a linked recorder last said it was doing, if it is busy. */
  progressOf(name: string): RecorderProgress | null {
    return this.latest.get(name) ?? null;
  }

  /**
   * There may be work: every linked recorder looks for it now (the claim
   * decides who gets what). Bursts are folded into one wake.
   */
  wake(): void {
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      for (const s of this.sessions.values()) s.send({ type: 'wake' });
    }, 300);
  }

  /** Stop what a recorder is doing (its job goes back by the usual lease rules). */
  cancel(name: string): boolean {
    return this.sessions.get(name)?.send({ type: 'cancel' }) ?? false;
  }

  private async sweepWork(): Promise<void> {
    const idle = [...this.sessions.keys()].filter((n) => !this.latest.has(n));
    if (idle.length === 0) return;
    try {
      const [row] = await db.queryAsync<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM cs2_highlights WHERE ${recordingWaiting()})
              + (SELECT COUNT(*) FROM cs2_match_reels WHERE ${recordingWaiting()})
              + (SELECT COUNT(*) FROM cs2_team_reels WHERE ${recordingWaiting()})
              + (SELECT COUNT(*) FROM cs2_tournament_reels WHERE ${recordingWaiting()})
              + (SELECT COUNT(*) FROM cs2_redress_queue WHERE status = 'queued')
              + (SELECT COUNT(*) FROM cs2_recorders WHERE benchmark_wanted = 1 AND enabled = 1) AS n`,
        ['', '', '', '']
      );
      if (Number(row?.n ?? 0) > 0) this.wake();
    } catch (error) {
      log.debug('[RECORDER-LINK] sweep failed', { error: (error as Error).message });
    }
  }
}

/** A recorder is done with a match: its line goes from the match page. */
function clearPublic(recorder: string, matchSlug: string): void {
  maybeIO()?.emit(`highlights:progress:${matchSlug}`, { recorder, step: null });
}

function emitAdmin(event: string, payload: object): void {
  maybeIO()?.to(ADMIN_ROOM).emit(event, payload);
}

export const recorderLink = new RecorderLink();

/** Start the link on the API's HTTP server (cs2 startup). */
export function startRecorderLink(server?: HttpServer): void {
  const http = server ?? (maybeIO()?.httpServer as HttpServer | undefined);
  if (!http) {
    log.warn('[RECORDER-LINK] no HTTP server; recorders keep polling');
    return;
  }
  recorderLink.attach(http);
}

/** There may be work for recorders (a clip, reel, redress or benchmark was queued). */
export function wakeRecorders(): void {
  recorderLink.wake();
}
