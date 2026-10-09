/**
 * The daily license check-in, and the event-license "what's this?" question.
 *
 * A license key is proof of payment, checked offline (./verify). An instance
 * **with a key** also tells autotournament.gg, once a day, that the key is in
 * use, so a key set up in more places than it covers shows up. Without a key
 * there is no check-in and no network call at all.
 *
 * **It never blocks, locks, degrades or delays anything.** It runs in the
 * background after boot, every 24 hours and when the key changes. Failures
 * (offline, LAN-only, a timeout, any answer but a valid 200) are logged at
 * debug level and otherwise ignored. What the server answers is only shown
 * to admins, as a notice.
 *
 * What is sent, and nothing else (no hostnames, IPs, names, player or match
 * data): the key itself (its id and signature), a random instance id made
 * once, the number of game servers, the platform version, the time, three
 * counts since the last check-in (finished matches, tournaments with activity,
 * the largest team count among them) and the admin's answer to the
 * event-license question. See CHECKIN_FIELDS and docs/reference/licensing.
 *
 * The endpoint is https://autotournament.gg/api/licenses/checkin.
 * LICENSE_CHECKIN_URL replaces it (tests and development only: https, or
 * http to localhost), and `off` turns the check-in off (CI). NODE_ENV=test
 * never checks in unless LICENSE_CHECKIN_URL names an endpoint.
 */

import { randomUUID } from 'crypto';
import { log } from '../../utils/logger';
import { decodeLicense, verifyLicense } from './verify';
import type { ServerLicenseState } from './gate';

export const DEFAULT_CHECKIN_URL = 'https://autotournament.gg/api/licenses/checkin';
export const CHECKIN_PRIVACY_URL = 'https://autotournament.gg/privacy#license-checkin';
export const CHECKIN_TIMEOUT_MS = 10_000;
export const CHECKIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After boot, before the first check-in. */
export const CHECKIN_STARTUP_DELAY_MS = 60_000;
/** A check-in this recent is not repeated (boot right after a key change). */
export const CHECKIN_MIN_GAP_MS = 10 * 60 * 1000;
export const NOTICE_MAX_LENGTH = 300;
/** Creating game servers with a paid key, when the license server can't be asked, needs a check-in this recent. */
export const CHECKIN_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
/** How often the event-license question may be asked, per instance. */
export const EVENT_PROMPT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** The request body's fields, in order. Shown to admins as "what is sent". */
export const CHECKIN_FIELDS = [
  'token',
  'key_id',
  'instance_id',
  'server_count',
  'platform_version',
  'sent_at',
  'matches_played',
  'tournaments_live',
  'max_tournament_teams',
  'declared',
  'product',
  'public_url',
] as const;

export const SETTING = {
  instanceId: 'license_instance_id',
  lastAt: 'license_checkin_last_at',
  result: 'license_checkin_result',
  countedSince: 'license_checkin_counted_since',
  declaration: 'license_event_declaration',
  /** The license's current terms from the last check-in (a signed lease; ./gate.ts). */
  lease: 'license_lease',
  prompt: 'license_event_prompt',
} as const;

export type Declared = 'testing' | 'new_event' | 'dates_moved' | 'none';
export const DECLARATION_ANSWERS = ['testing', 'new_event', 'dates_moved'] as const;
export type DeclarationAnswer = (typeof DECLARATION_ANSWERS)[number];
/** What the admin can do with the question: answer it, close it, or mute it for this license. */
export type EventPromptAction = DeclarationAnswer | 'dismissed' | 'dont_ask';

export interface CheckinBody {
  token: string;
  key_id: string;
  instance_id: string;
  server_count: number;
  platform_version: string;
  sent_at: string;
  matches_played: number;
  tournaments_live: number;
  max_tournament_teams: number;
  declared: Declared;
  product: 'platform';
  /** FRONTEND_BASE_URL's origin, when it is a real address; null otherwise. */
  public_url: string | null;
}

/** The server's usage summary for the key, as the admin UI gets it. */
export interface CheckinUsage {
  instances: number;
  servers: number;
  maxServers: number;
  windowDays: number;
  /** More servers across the key's instances than it covers. */
  abovePack: boolean;
  /** An event key with real event activity outside its dates. */
  outsideDates: boolean;
}

export interface CheckinResult {
  usage: CheckinUsage | null;
  /** Plain text from the server, at most NOTICE_MAX_LENGTH characters. Never HTML. */
  notice: string | null;
  /** Where the license stands (./gate.ts); null from an older license server. */
  license?: ServerLicenseState | null;
  /**
   * A subscription's current terms (servers, paid until), signed like a key:
   * the key itself never changes on renewal. Stored apart (SETTING.lease).
   */
  lease?: string | null;
  /** Servers in use on this license by every other install (one pool per license). */
  serversElsewhere?: number;
}

/** What the admin UI gets: when, the server's notice, and what is sent. */
export interface CheckinStatus {
  /** ISO time of the last successful check-in, or null. */
  lastAt: string | null;
  /** Plain text from the server (a calm note, never HTML), or null. */
  notice: string | null;
  /** The body's field names: exactly what is sent. */
  sent: string[];
  privacyUrl: string;
}

export interface Activity {
  /** Matches finished in the period. */
  matchesPlayed: number;
  /** Distinct tournaments with a match finished, or started, in the period. */
  tournamentsLive: number;
  /** The largest team count among those tournaments; 0 when none. */
  maxTournamentTeams: number;
}

export interface EventDeclaration {
  answer: DeclarationAnswer;
  at: string;
  by: string;
  licenseId: string;
}

export interface EventPromptState {
  /** ISO time the question was last shown and answered or closed. */
  askedAt: string | null;
  /** A license id the admin said not to ask about again. */
  mutedFor: string | null;
}

/** What the admin UI gets for an event license; null for other licenses. */
export interface EventPromptStatus {
  shouldAsk: boolean;
  validFrom: string;
  validTo: string;
  declared: Declared;
  declaredAt: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The key's id when it decodes as an ATL1 token (the signature is not checked), else null. */
export function keyIdOf(key: string | null): string | null {
  if (!key) return null;
  try {
    const { payload } = decodeLicense(key);
    const id = isObject(payload) ? payload.id : undefined;
    return typeof id === 'string' && id.trim() && id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

const OFF = new Set(['off', 'false', '0', 'no', 'none', 'disabled']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Where to check in, or null for no check-in at all: LICENSE_CHECKIN_URL
 * when set (`off` turns it off; https, or http to localhost only), none under
 * NODE_ENV=test without it, else the real endpoint.
 */
export function resolveCheckinUrl(env: {
  LICENSE_CHECKIN_URL?: string;
  NODE_ENV?: string;
}): string | null {
  const raw = env.LICENSE_CHECKIN_URL?.trim();
  if (!raw) return env.NODE_ENV === 'test' ? null : DEFAULT_CHECKIN_URL;
  if (OFF.has(raw.toLowerCase())) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return url.toString();
    if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url.toString();
  } catch {
    // not a URL
  }
  return null;
}

/** The server's notice as plain text: control characters dropped, trimmed, capped. */
export function cleanNotice(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > NOTICE_MAX_LENGTH
    ? `${text.slice(0, NOTICE_MAX_LENGTH - 1).trimEnd()}…`
    : text;
}

/** A 200 body, checked field by field. Null when it is not `{ ok: true, … }`. */
export function parseCheckinResponse(value: unknown): CheckinResult | null {
  if (!isObject(value) || value.ok !== true) return null;
  let usage: CheckinUsage | null = null;
  const u = value.usage;
  if (isObject(u)) {
    const instances = count(u.instances);
    const servers = count(u.servers);
    const maxServers = count(u.max_servers);
    const windowDays = count(u.window_days);
    if (
      instances !== null &&
      servers !== null &&
      maxServers !== null &&
      windowDays !== null &&
      typeof u.overuse === 'boolean' &&
      typeof u.outside_dates === 'boolean'
    ) {
      usage = {
        instances,
        servers,
        maxServers,
        windowDays,
        abovePack: u.overuse,
        outsideDates: u.outside_dates,
      };
    }
  }
  const license = parseLicenseState(value.license);
  const lease = cleanToken(value.lease);
  const elsewhere = count(value.servers_elsewhere ?? value.serversElsewhere);
  return {
    usage,
    notice: cleanNotice(value.notice),
    ...(license ? { license } : {}),
    ...(lease ? { lease } : {}),
    ...(elsewhere !== null ? { serversElsewhere: elsewhere } : {}),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATES = [
  'active',
  'past_due',
  'expired',
  'revoked',
  'replaced',
  'in_use_elsewhere',
] as const;

/** The answer's `license`, checked; null when missing or not understood. */
export function parseLicenseState(value: unknown): ServerLicenseState | null {
  if (!isObject(value) || !(STATES as readonly unknown[]).includes(value.status)) return null;
  const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v : null);
  return {
    status: value.status as ServerLicenseState['status'],
    validUntil: day(value.valid_until ?? value.validUntil),
    stopsOn: day(value.stops_on ?? value.stopsOn),
  };
}

function cleanToken(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('ATL1.') && value.length <= 4096
    ? value
    : null;
}

/** A stored result (JSON), or empty when missing or unreadable. */
export function parseStoredResult(raw: string | null): CheckinResult {
  if (!raw) return { usage: null, notice: null };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isObject(value)) return { usage: null, notice: null };
    const u = value.usage;
    let usage: CheckinUsage | null = null;
    if (isObject(u)) {
      const parsed = parseCheckinResponse({
        ok: true,
        usage: {
          instances: u.instances,
          servers: u.servers,
          max_servers: u.maxServers,
          window_days: u.windowDays,
          overuse: u.abovePack,
          outside_dates: u.outsideDates,
        },
      });
      usage = parsed?.usage ?? null;
    }
    const license = parseLicenseState(value.license);
    const elsewhere = count(value.serversElsewhere);
    return {
      usage,
      notice: cleanNotice(value.notice),
      ...(license ? { license } : {}),
      ...(elsewhere !== null ? { serversElsewhere: elsewhere } : {}),
    };
  } catch {
    return { usage: null, notice: null };
  }
}

export function parseDeclaration(raw: string | null): EventDeclaration | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObject(v)) return null;
    if (!(DECLARATION_ANSWERS as readonly unknown[]).includes(v.answer)) return null;
    if (typeof v.at !== 'string' || typeof v.licenseId !== 'string') return null;
    return {
      answer: v.answer as DeclarationAnswer,
      at: v.at,
      by: typeof v.by === 'string' ? v.by : 'unknown',
      licenseId: v.licenseId,
    };
  } catch {
    return null;
  }
}

export function parsePromptState(raw: string | null): EventPromptState {
  if (!raw) return { askedAt: null, mutedFor: null };
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObject(v)) return { askedAt: null, mutedFor: null };
    return {
      askedAt: typeof v.askedAt === 'string' ? v.askedAt : null,
      mutedFor: typeof v.mutedFor === 'string' ? v.mutedFor : null,
    };
  } catch {
    return { askedAt: null, mutedFor: null };
  }
}

/** The declaration for this license, or `none`. */
export function declaredFor(
  declaration: EventDeclaration | null,
  licenseId: string | null
): Declared {
  return declaration && licenseId && declaration.licenseId === licenseId
    ? declaration.answer
    : 'none';
}

export function buildCheckinBody(input: {
  key: string;
  keyId: string;
  instanceId: string;
  serverCount: number | null;
  version: string;
  now: Date;
  activity: Activity;
  declared: Declared;
  publicUrl?: string | null;
}): CheckinBody {
  return {
    token: input.key,
    key_id: input.keyId,
    instance_id: input.instanceId,
    server_count: count(input.serverCount) ?? 0,
    platform_version: input.version,
    sent_at: input.now.toISOString(),
    matches_played: count(input.activity.matchesPlayed) ?? 0,
    tournaments_live: count(input.activity.tournamentsLive) ?? 0,
    max_tournament_teams: count(input.activity.maxTournamentTeams) ?? 0,
    declared: input.declared,
    product: 'platform',
    public_url: input.publicUrl ?? null,
  };
}

/**
 * The period's counts from plain rows: matches finished (with their
 * tournament), tournaments started, and every tournament's team list.
 */
export function summarizeActivity(
  finished: Array<{ tournament_id: number | null }>,
  startedTournamentIds: number[],
  tournaments: Array<{ id: number; team_ids: string | null }>
): Activity {
  const ids = new Set<number>(startedTournamentIds);
  for (const match of finished) if (match.tournament_id !== null) ids.add(match.tournament_id);
  let maxTournamentTeams = 0;
  for (const row of tournaments) {
    if (!ids.has(row.id)) continue;
    let teams = 0;
    try {
      const list = JSON.parse(row.team_ids ?? '[]') as unknown;
      teams = Array.isArray(list) ? list.length : 0;
    } catch {
      teams = 0;
    }
    maxTournamentTeams = Math.max(maxTournamentTeams, teams);
  }
  return { matchesPlayed: finished.length, tournamentsLive: ids.size, maxTournamentTeams };
}

/** YYYY-MM-DD in the server's local time zone. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Real event activity outside an event license's dates (a day of grace on
 * either side, local dates): a tournament started, or more than two matches
 * finished on one day. Light testing stays below it. Times are unix seconds.
 */
export function activityOutsideDates(
  window: { validFrom: string; validTo: string },
  matchFinishedAt: number[],
  tournamentStartedAt: number[]
): boolean {
  const from = shiftDay(window.validFrom, -1);
  const to = shiftDay(window.validTo, 1);
  const outside = (seconds: number) => {
    const day = localDay(new Date(seconds * 1000));
    return day < from || day > to;
  };
  if (tournamentStartedAt.some(outside)) return true;
  const perDay = new Map<string, number>();
  for (const seconds of matchFinishedAt) {
    if (!outside(seconds)) continue;
    const day = localDay(new Date(seconds * 1000));
    const n = (perDay.get(day) ?? 0) + 1;
    if (n > 2) return true;
    perDay.set(day, n);
  }
  return false;
}

/** When to look for activity from: the last time it was asked, at most 30 days back. */
export function promptLookbackStart(prompt: EventPromptState, now: Date): Date {
  const floor = now.getTime() - EVENT_PROMPT_INTERVAL_MS;
  const asked = prompt.askedAt ? Date.parse(prompt.askedAt) : NaN;
  return new Date(Number.isNaN(asked) ? floor : Math.max(floor, asked));
}

/** Whether the event-license question may be asked now (before looking at activity). */
export function promptAllowed(prompt: EventPromptState, licenseId: string, now: Date): boolean {
  if (prompt.mutedFor === licenseId) return false;
  const asked = prompt.askedAt ? Date.parse(prompt.askedAt) : NaN;
  return Number.isNaN(asked) || now.getTime() - asked >= EVENT_PROMPT_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// The check-in
// ---------------------------------------------------------------------------

/**
 * Whether `lease` is genuine current terms for the license of `key`: signed
 * by us, same license id and kind, issued no earlier than the key.
 */
export function leaseOf(key: string, lease: string): boolean {
  const a = verifyLicense(key);
  const b = verifyLicense(lease);
  if (!a.valid || !b.valid || !b.license || !a.license) return false;
  return (
    b.license.lease === true &&
    a.license.id === b.license.id &&
    a.license.kind === b.license.kind &&
    b.license.issued_at >= a.license.issued_at
  );
}

export interface CheckinStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

export interface CheckinDeps {
  store: CheckinStore;
  getKey(): Promise<string | null>;
  countServers(): Promise<number | null>;
  /** Counts for [sinceSeconds, untilSeconds). */
  activity(sinceSeconds: number, untilSeconds: number): Promise<Activity>;
  version: string;
  /** Where players open the platform (FRONTEND_BASE_URL), sent with the check-in. */
  publicUrl?: () => string | null;
  /** Stores a renewed key the server handed back (same license, newer). */
  url?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  newId?: () => string;
}

export type CheckinOutcome = 'disabled' | 'no-key' | 'recent' | 'sent' | 'failed';

export class LicenseCheckin {
  private running: Promise<CheckinOutcome> | null = null;
  /** A forced run asked for while another ran (the key changed): run again after it. */
  private rerun = false;

  constructor(private readonly deps: CheckinDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** The endpoint, or null when check-ins are off here (see resolveCheckinUrl). */
  url(): string | null {
    return resolveCheckinUrl(
      this.deps.url !== undefined
        ? { LICENSE_CHECKIN_URL: this.deps.url }
        : { LICENSE_CHECKIN_URL: process.env.LICENSE_CHECKIN_URL, NODE_ENV: process.env.NODE_ENV }
    );
  }

  /** The instance id: made once (random UUID v4), then reused. */
  async instanceId(): Promise<string> {
    const stored = (await this.deps.store.get(SETTING.instanceId))?.trim();
    if (stored) return stored;
    const id = this.deps.newId ? this.deps.newId() : randomUUID();
    await this.deps.store.set(SETTING.instanceId, id);
    return id;
  }

  /** Check in now. Never throws; one at a time. */
  run(options: { force?: boolean } = {}): Promise<CheckinOutcome> {
    if (this.running) {
      if (options.force) this.rerun = true;
      return this.running;
    }
    this.running = this.attempt(options.force ?? false)
      .catch((error: unknown) => {
        log.debug('[LICENSE] Check-in failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return 'failed' as const;
      })
      .finally(() => {
        this.running = null;
        if (this.rerun) {
          this.rerun = false;
          void this.run({ force: true });
        }
      });
    return this.running;
  }

  /**
   * Asks the license server, right before creating game servers, whether
   * `adding` more fit the whole license now (every install using the key
   * shares one limit). `current` is this install's servers. 'unreachable'
   * when it can't be asked (the caller then falls back to the last check-in,
   * if it is recent); 'skipped' when check-ins are off (tests, CI).
   */
  async reserve(
    current: number,
    adding: number
  ): Promise<
    | { result: 'allowed' }
    | { result: 'refused'; reason: string; maxServers: number | null; elsewhere: number }
    | { result: 'unreachable' | 'skipped' }
  > {
    const url = this.url();
    if (!url) return { result: 'skipped' };
    const key = await this.deps.getKey();
    const keyId = keyIdOf(key);
    if (!key || !keyId) return { result: 'skipped' };
    const body = {
      ...buildCheckinBody({
        key,
        keyId,
        instanceId: await this.instanceId(),
        serverCount: current,
        version: this.deps.version,
        now: this.now(),
        activity: { matchesPlayed: 0, tournamentsLive: 0, maxTournamentTeams: 0 },
        declared: 'none',
        publicUrl: this.deps.publicUrl ? this.deps.publicUrl() : null,
      }),
      adding,
    };
    try {
      const doFetch = this.deps.fetch ?? globalThis.fetch;
      const res = await doFetch(url.replace(/\/checkin(\/?)$/, '/reserve$1'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: globalThis.AbortSignal.timeout(CHECKIN_TIMEOUT_MS),
      });
      if (res.status !== 200) return { result: 'unreachable' };
      const answer = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!answer || answer.ok !== true || typeof answer.allowed !== 'boolean')
        return { result: 'unreachable' };
      if (answer.allowed) return { result: 'allowed' };
      return {
        result: 'refused',
        reason: typeof answer.reason === 'string' ? answer.reason : 'server_limit',
        maxServers: count(answer.max_servers),
        elsewhere: count(answer.servers_elsewhere) ?? 0,
      };
    } catch {
      return { result: 'unreachable' };
    }
  }

  /** Whether the last successful check-in is recent enough to create servers on without asking (CHECKIN_FRESH_MS). */
  async checkedInRecently(): Promise<boolean> {
    const last = Date.parse((await this.deps.store.get(SETTING.lastAt)) ?? '');
    return !Number.isNaN(last) && this.now().getTime() - last < CHECKIN_FRESH_MS;
  }

  private async attempt(force: boolean): Promise<CheckinOutcome> {
    const url = this.url();
    if (!url) return 'disabled';
    const key = await this.deps.getKey();
    const keyId = keyIdOf(key);
    if (!key || !keyId) return 'no-key';

    const now = this.now();
    if (!force) {
      const last = Date.parse((await this.deps.store.get(SETTING.lastAt)) ?? '');
      if (!Number.isNaN(last) && now.getTime() - last < CHECKIN_MIN_GAP_MS) return 'recent';
    }

    const until = Math.floor(now.getTime() / 1000);
    const cursor = Number((await this.deps.store.get(SETTING.countedSince)) ?? '');
    const since =
      Number.isSafeInteger(cursor) && cursor > 0 && cursor <= until ? cursor : until - 24 * 60 * 60;

    const [instanceId, serverCount, activity, declaration] = await Promise.all([
      this.instanceId(),
      this.deps.countServers().catch(() => null),
      this.deps
        .activity(since, until)
        .catch((): Activity => ({ matchesPlayed: 0, tournamentsLive: 0, maxTournamentTeams: 0 })),
      this.deps.store.get(SETTING.declaration).then(parseDeclaration),
    ]);

    const body = buildCheckinBody({
      key,
      keyId,
      instanceId,
      serverCount,
      version: this.deps.version,
      now,
      activity,
      declared: declaredFor(declaration, keyId),
      publicUrl: this.deps.publicUrl ? this.deps.publicUrl() : null,
    });

    const doFetch = this.deps.fetch ?? globalThis.fetch;
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: globalThis.AbortSignal.timeout(CHECKIN_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      log.debug(`[LICENSE] Check-in answered ${res.status}; ignored`);
      return 'failed';
    }
    const result = parseCheckinResponse(await res.json().catch(() => null));
    if (!result) {
      log.debug('[LICENSE] Check-in answer was not understood; ignored');
      return 'failed';
    }
    // The key may have changed while this was on its way: keep nothing then.
    if ((await this.deps.getKey()) !== key) return 'failed';
    await this.deps.store.set(SETTING.lastAt, now.toISOString());
    const { lease, ...kept } = result;
    await this.deps.store.set(SETTING.result, JSON.stringify(kept));
    if (lease && leaseOf(key, lease) && (await this.deps.store.get(SETTING.lease)) !== lease) {
      await this.deps.store.set(SETTING.lease, lease);
      log.info("[LICENSE] Picked up the license's current terms");
    }
    await this.deps.store.set(SETTING.countedSince, String(until));
    log.debug('[LICENSE] Checked in');
    return 'sent';
  }

  /** The key was cleared or changed: forget what the server said about the old one. */
  async clearState(): Promise<void> {
    await this.deps.store.set(SETTING.lastAt, null);
    await this.deps.store.set(SETTING.result, null);
    await this.deps.store.set(SETTING.lease, null);
  }

  async status(hasKey: boolean): Promise<CheckinStatus> {
    const sent = [...CHECKIN_FIELDS];
    if (!hasKey) return { lastAt: null, notice: null, sent, privacyUrl: CHECKIN_PRIVACY_URL };
    const [lastAt, result] = await Promise.all([
      this.deps.store.get(SETTING.lastAt),
      this.deps.store.get(SETTING.result),
    ]);
    return {
      lastAt: lastAt || null,
      notice: parseStoredResult(result).notice,
      sent,
      privacyUrl: CHECKIN_PRIVACY_URL,
    };
  }

  /** Record the admin's answer to the event-license question. */
  async answerEventPrompt(
    action: EventPromptAction,
    licenseId: string,
    actor: string
  ): Promise<void> {
    const now = this.now().toISOString();
    const prompt = parsePromptState(await this.deps.store.get(SETTING.prompt));
    if ((DECLARATION_ANSWERS as readonly string[]).includes(action)) {
      const declaration: EventDeclaration = {
        answer: action as DeclarationAnswer,
        at: now,
        by: actor,
        licenseId,
      };
      await this.deps.store.set(SETTING.declaration, JSON.stringify(declaration));
    }
    const next: EventPromptState = {
      askedAt: now,
      mutedFor: action === 'dont_ask' ? licenseId : prompt.mutedFor,
    };
    await this.deps.store.set(SETTING.prompt, JSON.stringify(next));
  }

  /**
   * The event-license question's state for a genuine event license. The
   * activity reader gets unix seconds and returns finish and start times.
   */
  async eventPrompt(
    license: { id: string; kind: string; validFrom: string | null; validTo: string | null } | null,
    readActivity: (
      sinceSeconds: number
    ) => Promise<{ matchFinishedAt: number[]; tournamentStartedAt: number[] }>
  ): Promise<EventPromptStatus | null> {
    if (!license || license.kind !== 'event' || !license.validFrom || !license.validTo) return null;
    const [prompt, declaration] = await Promise.all([
      this.deps.store.get(SETTING.prompt).then(parsePromptState),
      this.deps.store.get(SETTING.declaration).then(parseDeclaration),
    ]);
    const declared = declaredFor(declaration, license.id);
    const window = { validFrom: license.validFrom, validTo: license.validTo };
    const now = this.now();
    let shouldAsk = false;
    if (promptAllowed(prompt, license.id, now)) {
      const since = Math.floor(promptLookbackStart(prompt, now).getTime() / 1000);
      try {
        const seen = await readActivity(since);
        shouldAsk = activityOutsideDates(window, seen.matchFinishedAt, seen.tournamentStartedAt);
      } catch (error) {
        log.debug('[LICENSE] Could not read activity for the event-license question', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      shouldAsk,
      ...window,
      declared,
      declaredAt: declared === 'none' ? null : (declaration?.at ?? null),
    };
  }
}
