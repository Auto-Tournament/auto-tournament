/**
 * The built-in demo worker: the release image carries the worker binary
 * (worker/, at /app/bin/at-worker) and the API runs it as a child process,
 * so demo stats, the 2D replay and the clip moments work on a fresh install
 * with no third container and no token. It gets a token that lives only in
 * this process's memory (utils/serviceTokens addInternalServiceToken) and
 * talks to the API on localhost. Restarted with a growing pause when it
 * exits; stopped with the API.
 *
 * AT_BUILTIN_WORKER=0 turns it off (an install that runs its own workers).
 * AT_WORKER_MAX_MB (default 8192) caps its memory: past it the worker is
 * killed, so one bad demo can't take the host's memory from the game servers.
 * AT_CS2_DIR (a CS2 game/csgo folder mounted into the container) gives it the
 * radar images; without it the replay draws the map's outline.
 */
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { log } from '../utils/logger';
import { addInternalServiceToken } from '../utils/serviceTokens';

export const BUILTIN_WORKER_BIN = process.env.AT_WORKER_BIN || '/app/bin/at-worker';

export const WORKER_MAX_MB = Number(process.env.AT_WORKER_MAX_MB) || 8192;

let child: ChildProcess | null = null;
let watch: ReturnType<typeof setInterval> | null = null;
let stopping = false;
let restarts = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function enabled(): boolean {
  return process.env.AT_BUILTIN_WORKER !== '0' && fs.existsSync(BUILTIN_WORKER_BIN);
}

/** Resident memory in MB from a /proc/<pid>/status text, or null when it has no VmRSS line. */
export function rssMb(status: string): number | null {
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
  return m ? Number(m[1]) / 1024 : null;
}

function pipeLines(stream: NodeJS.ReadableStream | null, level: 'info' | 'warn'): void {
  if (!stream) return;
  let rest = '';
  stream.on('data', (chunk: Buffer) => {
    const lines = (rest + chunk.toString('utf8')).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) log[level](`[WORKER] ${line.trim()}`);
  });
}

function run(port: number): void {
  const secret = crypto.randomBytes(32).toString('hex');
  addInternalServiceToken('builtin-worker', secret);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    AT_URL: `http://127.0.0.1:${port}`,
    AT_WORKER_TOKEN: secret,
    AT_WORKER_NAME: process.env.AT_WORKER_NAME || 'built-in',
    // Go's soft limit: the GC works harder well before the hard cap below.
    GOMEMLIMIT: process.env.GOMEMLIMIT || `${Math.floor(WORKER_MAX_MB * 0.75)}MiB`,
  };
  for (const key of ['AT_CS2_DIR', 'AT_WORKSHOP_DIRS', 'AT_POLL_SECONDS', 'TZ']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const started = Date.now();
  child = spawn(BUILTIN_WORKER_BIN, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  pipeLines(child.stdout, 'info');
  pipeLines(child.stderr, 'info');
  child.on('error', (error) => log.warn(`[WORKER] could not start: ${error.message}`));
  const pid = child.pid;
  // Polled because a demo grew it by ~100 MB/s: at 2 s it stops well short of the host's memory.
  watch = setInterval(() => {
    let mb: number | null = null;
    try {
      mb = rssMb(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    } catch {
      return; // not Linux, or already gone
    }
    if (mb !== null && mb > WORKER_MAX_MB && child?.pid === pid) {
      log.warn(
        `[WORKER] the built-in demo worker uses ${Math.round(mb)} MB (cap ${WORKER_MAX_MB}); stopping it`
      );
      child?.kill('SIGKILL');
    }
  }, 2_000);
  child.on('exit', (code, signal) => {
    if (watch) clearInterval(watch);
    watch = null;
    child = null;
    if (stopping) return;
    // A run that lasted a while starts the pauses over.
    if (Date.now() - started > 10 * 60_000) restarts = 0;
    restarts += 1;
    const wait = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(restarts, 8));
    log.warn(
      `[WORKER] the built-in demo worker exited (${signal ?? `code ${code}`}); starting it again in ${Math.round(wait / 1000)} s`
    );
    timer = setTimeout(() => run(port), wait);
  });
  log.info(`[WORKER] built-in demo worker started (pid ${child.pid})`);
}

/** Start the built-in worker (once the API listens on `port`). */
export function startBuiltinWorker(port: number): void {
  if (child || !enabled()) return;
  stopping = false;
  run(port);
}

export function stopBuiltinWorker(): void {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (watch) clearInterval(watch);
  watch = null;
  child?.kill('SIGTERM');
  child = null;
}
