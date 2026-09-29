/**
 * Server settings for Ready Up servers: a fleet default plus a per-server
 * override, pushed as two messages (FLEET.md §7.4, §7.5):
 *
 * - `server.config {rev, settings}` for the fields of its schema
 *   (`config`): chat prefixes, hostname format, demo path/name, series-end
 *   kick delays, offline pause, scrim when idle / scrim knife, warmup, status
 *   HTTP. Ready Up applies `hostname_format`, `scrim_knife` and
 *   `series_end_kick_delay.*` today; the rest is stored there for later.
 * - `cmd settings.set {settings}` for the match plugin's other server
 *   settings (`match`): minimum ready, playout, autoready, pause command,
 *   kick when no match, whitelist default, reset cvars. All or none on the
 *   server; its `cmd.result.output` lists every setting after the change.
 *
 * `rev` (`cs2_fleet_lists` 'server_config') grows on every saved change. A
 * change is pushed at once (the default to every enrolled server, an override
 * to its server); a hello pushes again when the server's last push is not the
 * current rev.
 */

import crypto from 'crypto';
import { log } from '../../../../utils/logger';
import { sendReliable } from '../reliable';
import { validatePayload, type CmdPayload, type ServerConfigPayload } from '../protocol/v1';
import {
  bumpListIfChanged,
  enrolledServerIds,
  readList,
  readPrefs,
  recordPush,
  writeListData,
  writePref,
  type ServerPrefs,
} from './store';

export type ServerConfigSettings = ServerConfigPayload['settings'];

/**
 * The match plugin's server settings that `server.config` does not carry
 * (Ready Up plugins/match/readyup/server_settings.cpp). `knife_enabled_default`,
 * `hostname_format` and the kick delays go through server.config instead.
 */
export const MATCH_SETTINGS = {
  minimum_ready_required: { kind: 'int', min: 0, max: 32 },
  playout_enabled_default: { kind: 'bool' },
  autoready_enabled: { kind: 'bool' },
  reset_cvars_on_series_end: { kind: 'bool' },
  use_pause_command_for_tactical_pause: { kind: 'bool' },
  kick_when_no_match_loaded: { kind: 'bool' },
  whitelist_enabled_default: { kind: 'bool' },
} as const;

export type MatchSettingName = keyof typeof MATCH_SETTINGS;
export type MatchSettings = Partial<Record<MatchSettingName, boolean | number>>;

export interface FleetSettings {
  config: ServerConfigSettings;
  match: MatchSettings;
}

type Field =
  | { kind: 'string'; max: number }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'object'; fields: Record<string, Field> };

/** server.config.json `settings`, with the platform's own bounds. */
const CONFIG_FIELDS: Record<string, Field> = {
  chat_prefix: { kind: 'string', max: 64 },
  admin_chat_prefix: { kind: 'string', max: 64 },
  hostname_format: { kind: 'string', max: 127 },
  demo: {
    kind: 'object',
    fields: { path: { kind: 'string', max: 255 }, name_format: { kind: 'string', max: 255 } },
  },
  series_end_kick_delay: {
    kind: 'object',
    fields: {
      no_demo: { kind: 'int', min: 0, max: 3600 },
      demo_no_upload: { kind: 'int', min: 0, max: 3600 },
      demo_upload: { kind: 'int', min: 0, max: 3600 },
    },
  },
  offline_pause_minutes: { kind: 'int', min: 0, max: 1440 },
  scrim_when_idle: { kind: 'bool' },
  scrim_knife: { kind: 'bool' },
  warmup: {
    kind: 'object',
    fields: {
      message_html: { kind: 'string', max: 4096 },
      respawn: { kind: 'bool' },
      money: { kind: 'int', min: 0, max: 65535 },
    },
  },
  status_http: { kind: 'object', fields: { token: { kind: 'string', max: 256 } } },
};

/** Control characters other than tab and newline (C0, DEL). */
export function hasControlChars(text: string): boolean {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) return true;
  }
  return false;
}

function checkField(path: string, field: Field, value: unknown, errors: string[]): unknown {
  switch (field.kind) {
    case 'string':
      if (typeof value !== 'string') errors.push(`${path} must be a string`);
      else if (value.length > field.max)
        errors.push(`${path} is longer than ${field.max} characters`);
      else if (hasControlChars(value)) errors.push(`${path} contains control characters`);
      else return value;
      return undefined;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value))
        errors.push(`${path} must be an integer`);
      else if (value < field.min || value > field.max)
        errors.push(`${path} must be ${field.min}-${field.max}`);
      else return value;
      return undefined;
    case 'bool':
      if (typeof value !== 'boolean') errors.push(`${path} must be true or false`);
      else return value;
      return undefined;
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path} must be an object`);
        return undefined;
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const sub = field.fields[k];
        if (!sub) {
          errors.push(`${path}.${k} is not a setting`);
          continue;
        }
        if (v === undefined || v === null) continue;
        const checked = checkField(`${path}.${k}`, sub, v, errors);
        if (checked !== undefined) out[k] = checked;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  }
}

/**
 * Validate settings from the API (`{config?, match?}`). Unknown names are
 * errors; null / undefined values mean "not set" (inherit the default).
 */
export function validateSettings(
  input: unknown
): { ok: true; value: FleetSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (input === undefined || input === null) return { ok: true, value: { config: {}, match: {} } };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, errors: ['settings must be an object'] };
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) {
    if (k !== 'config' && k !== 'match')
      errors.push(`${k} is not a settings group (config, match)`);
  }
  const config =
    raw.config === undefined || raw.config === null
      ? {}
      : ((checkField('config', { kind: 'object', fields: CONFIG_FIELDS }, raw.config, errors) ??
          {}) as ServerConfigSettings);
  const match: MatchSettings = {};
  if (raw.match !== undefined && raw.match !== null) {
    if (typeof raw.match !== 'object' || Array.isArray(raw.match))
      errors.push('match must be an object');
    else {
      for (const [k, v] of Object.entries(raw.match as Record<string, unknown>)) {
        const spec = (
          MATCH_SETTINGS as Record<
            string,
            { kind: 'bool' } | { kind: 'int'; min: number; max: number }
          >
        )[k];
        if (!spec) {
          errors.push(`match.${k} is not a setting`);
          continue;
        }
        if (v === undefined || v === null) continue;
        const checked = checkField(`match.${k}`, spec, v, errors);
        if (checked !== undefined) match[k as MatchSettingName] = checked as boolean | number;
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  // The schema is the last word on what reaches a server.
  const schema = validatePayload('server.config', { rev: 0, settings: config });
  if (!schema.ok) return { ok: false, errors: schema.errors };
  return { ok: true, value: { config, match } };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeObjects(
  base: Record<string, unknown>,
  over: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === null) continue;
    out[k] =
      isPlainObject(v) && isPlainObject(out[k])
        ? mergeObjects(out[k] as Record<string, unknown>, v)
        : v;
  }
  return out;
}

/** The effective settings of a server: its override on top of the fleet default (nested objects merge). */
export function mergeSettings(
  base: FleetSettings,
  override: FleetSettings | null | undefined
): FleetSettings {
  if (!override) return { config: { ...base.config }, match: { ...base.match } };
  return {
    config: mergeObjects(
      base.config as Record<string, unknown>,
      override.config as Record<string, unknown>
    ) as ServerConfigSettings,
    match: { ...base.match, ...stripNulls(override.match) },
  };
}

function stripNulls<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)
  ) as T;
}

export function hasSettings(s: FleetSettings): { config: boolean; match: boolean } {
  return {
    config: Object.keys(s.config ?? {}).length > 0,
    match: Object.keys(s.match ?? {}).length > 0,
  };
}

/** For API responses: the status HTTP token is write-only. */
export function redactSettings(s: FleetSettings): FleetSettings & { statusTokenSet: boolean } {
  const token = s.config?.status_http?.token;
  const config = { ...s.config };
  if (config.status_http) {
    const rest = { ...config.status_http };
    delete rest.token;
    if (Object.keys(rest).length > 0) config.status_http = rest;
    else delete config.status_http;
  }
  return {
    config,
    match: { ...s.match },
    statusTokenSet: typeof token === 'string' && token.length > 0,
  };
}

/**
 * A save keeps the stored status token unless the new settings set one
 * (`''` clears it): the UI never sees the token, so it cannot send it back.
 */
export function keepStatusToken(next: FleetSettings, stored: FleetSettings | null): FleetSettings {
  const incoming = next.config?.status_http?.token;
  if (incoming !== undefined) {
    if (incoming !== '') return next;
    const config = { ...next.config };
    delete config.status_http;
    return { ...next, config };
  }
  const old = stored?.config?.status_http?.token;
  if (!old) return next;
  return {
    ...next,
    config: { ...next.config, status_http: { ...(next.config.status_http ?? {}), token: old } },
  };
}

/** The server.config payload for effective settings (null when there is nothing to send). */
export function buildServerConfigPayload(
  rev: number,
  settings: FleetSettings
): ServerConfigPayload | null {
  if (!hasSettings(settings).config) return null;
  return { rev, settings: settings.config };
}

const PLATFORM_ISSUER = { user_id: 'platform', name: 'Auto Tournament', root: false } as const;

/** The settings.set cmd for effective settings (null when there is nothing to send). */
export function buildSettingsSetCmd(
  settings: FleetSettings,
  issuedBy: CmdPayload['issued_by'] = PLATFORM_ISSUER
): CmdPayload | null {
  if (!hasSettings(settings).match) return null;
  return {
    name: 'settings.set',
    args: { settings: { ...settings.match } },
    issued_by: issuedBy,
    expires_at: 0,
  };
}

function asSettings(raw: unknown): FleetSettings | null {
  if (!isPlainObject(raw)) return null;
  return {
    config: (isPlainObject(raw.config) ? raw.config : {}) as ServerConfigSettings,
    match: (isPlainObject(raw.match) ? raw.match : {}) as MatchSettings,
  };
}

function settingsHash(scope: string, s: FleetSettings): string {
  return crypto
    .createHash('sha256')
    .update(`${scope}:${JSON.stringify(s)}`)
    .digest('hex');
}

export async function getDefaultSettings(): Promise<{
  settings: FleetSettings;
  rev: number;
  updatedBy: string | null;
  updatedAt: number | null;
}> {
  const row = await readList('server_config');
  return {
    settings: asSettings(row.data) ?? { config: {}, match: {} },
    rev: row.rev,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export function overrideOf(prefs: ServerPrefs): FleetSettings | null {
  return asSettings(prefs.settings);
}

export async function effectiveSettings(serverId: string): Promise<{
  rev: number;
  defaults: FleetSettings;
  override: FleetSettings | null;
  effective: FleetSettings;
  prefs: ServerPrefs;
}> {
  const [def, prefs] = await Promise.all([getDefaultSettings(), readPrefs(serverId)]);
  const override = overrideOf(prefs);
  return {
    rev: def.rev,
    defaults: def.settings,
    override,
    effective: mergeSettings(def.settings, override),
    prefs,
  };
}

/** Send a server its effective settings: server.config and/or settings.set. */
export async function pushSettings(
  serverId: string,
  issuedBy?: CmdPayload['issued_by']
): Promise<{
  rev: number;
  serverConfig: { seq: number } | null;
  settingsSet: { id: string } | null;
}> {
  const { rev, effective } = await effectiveSettings(serverId);
  const cfg = buildServerConfigPayload(rev, effective);
  let serverConfig: { seq: number } | null = null;
  if (cfg) {
    const sent = await sendReliable(serverId, { type: 'server.config', payload: cfg });
    await recordPush(serverId, 'server_config', { rev, seq: sent.seq });
    serverConfig = { seq: sent.seq };
  }
  const cmd = buildSettingsSetCmd(effective, issuedBy);
  let settingsSet: { id: string } | null = null;
  if (cmd) {
    const sent = await sendReliable(serverId, { type: 'cmd', payload: cmd });
    await recordPush(serverId, 'settings', { rev, id: sent.id, seq: sent.seq });
    settingsSet = { id: sent.id };
  }
  return { rev, serverConfig, settingsSet };
}

/** Whether a hello should push the settings again: something to send, and not this rev yet. */
export function settingsHelloNeeded(
  rev: number,
  effective: FleetSettings,
  prefs: ServerPrefs
): boolean {
  const has = hasSettings(effective);
  const cfgBehind = has.config && prefs.pushed.server_config?.rev !== rev;
  const setBehind = has.match && prefs.pushed.settings?.rev !== rev;
  return cfgBehind || setBehind;
}

export async function settingsOnHello(serverId: string): Promise<boolean> {
  const { rev, effective, prefs } = await effectiveSettings(serverId);
  if (!settingsHelloNeeded(rev, effective, prefs)) return false;
  await pushSettings(serverId);
  return true;
}

/** Save the fleet default and push it to every enrolled server. */
export async function saveDefaultSettings(
  settings: FleetSettings,
  updatedBy: string | null,
  issuedBy?: CmdPayload['issued_by']
): Promise<{ rev: number; pushed: number }> {
  const current = await getDefaultSettings();
  const next = keepStatusToken(settings, current.settings);
  await writeListData('server_config', next, updatedBy);
  const bumped = await bumpListIfChanged('server_config', settingsHash('default', next));
  if (bumped === null) return { rev: current.rev, pushed: 0 };
  let pushed = 0;
  for (const serverId of await enrolledServerIds()) {
    try {
      await pushSettings(serverId, issuedBy);
      pushed += 1;
    } catch (error) {
      log.warn(`[FLEET] ${serverId}: settings push failed: ${(error as Error).message}`);
    }
  }
  log.info(`[FLEET] fleet default settings saved (rev ${bumped}) → ${pushed} server(s)`);
  return { rev: bumped, pushed };
}

/** Save (or with null, clear) one server's override, and push its effective settings. */
export async function saveServerSettings(
  serverId: string,
  settings: FleetSettings | null,
  updatedBy: string | null,
  issuedBy?: CmdPayload['issued_by']
): Promise<{ rev: number }> {
  const prefs = await readPrefs(serverId);
  const next = settings ? keepStatusToken(settings, overrideOf(prefs)) : null;
  await writePref(serverId, 'settings', next, updatedBy);
  const bumped = await bumpListIfChanged(
    'server_config',
    settingsHash(`server:${serverId}`, next ?? { config: {}, match: {} })
  );
  const rev = bumped ?? (await readList('server_config')).rev;
  if (bumped !== null) {
    await pushSettings(serverId, issuedBy);
    log.info(`[FLEET] ${serverId}: settings override saved (rev ${rev})`);
  }
  return { rev };
}
