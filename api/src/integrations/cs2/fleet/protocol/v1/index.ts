/**
 * The fleet protocol v1 schemas, loaded, and a validator over them.
 *
 * The `*.json` files next to this are the contract (FLEET.md D18): Ready Up
 * and csm copy them. This file only wires them into ajv (draft 2020-12).
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import defs from './defs.json';
import matchDefs from './match.defs.json';
import envelope from './envelope.json';
import hello from './messages/hello.json';
import welcome from './messages/welcome.json';
import ping from './messages/ping.json';
import pong from './messages/pong.json';
import ack from './messages/ack.json';
import error from './messages/error.json';
import serverConfig from './messages/server.config.json';
import authRotate from './messages/auth.rotate.json';
import authRotated from './messages/auth.rotated.json';
import matchAssign from './messages/match.assign.json';
import matchUpdate from './messages/match.update.json';
import matchUnassign from './messages/match.unassign.json';
import cmd from './messages/cmd.json';
import cmdResult from './messages/cmd.result.json';
import stateRequest from './messages/state.request.json';
import stateSnapshot from './messages/state.snapshot.json';
import statePatch from './messages/state.patch.json';
import serverAvailability from './messages/server.availability.json';
import adminsSet from './messages/admins.set.json';
import skinsLoadout from './messages/skins.loadout.json';
import skinsInvalidate from './messages/skins.invalidate.json';
import skinsStattrak from './messages/skins.stattrak.json';
import eventPlayerConnect from './messages/event.player_connect.json';
import eventPlayerDisconnect from './messages/event.player_disconnect.json';
import eventPlayerTeam from './messages/event.player_team.json';
import eventPlayerReady from './messages/event.player_ready.json';
import eventPlayerUnready from './messages/event.player_unready.json';
import eventPhase from './messages/event.phase.json';
import eventKnifeResult from './messages/event.knife_result.json';
import eventSidePicked from './messages/event.side_picked.json';
import eventRoundStart from './messages/event.round_start.json';
import eventRoundEnd from './messages/event.round_end.json';
import eventBackup from './messages/event.backup.json';
import eventPause from './messages/event.pause.json';
import eventHalftime from './messages/event.halftime.json';
import eventOvertime from './messages/event.overtime.json';
import eventRoundsVoided from './messages/event.rounds_voided.json';
import eventMapResult from './messages/event.map_result.json';
import eventSeriesEnd from './messages/event.series_end.json';
import eventDemo from './messages/event.demo.json';
import eventMatchRestored from './messages/event.match_restored.json';
import eventForfeit from './messages/event.forfeit.json';
import eventGg from './messages/event.gg.json';
import eventAdminCalled from './messages/event.admin_called.json';
import eventError from './messages/event.error.json';
import demoBegin from './messages/demo.begin.json';
import demoChunk from './messages/demo.chunk.json';
import demoEnd from './messages/demo.end.json';
import demoAck from './messages/demo.ack.json';
import enrollRequest from './http/enroll.request.json';
import enrollResponse from './http/enroll.response.json';
import type { Envelope, FleetMessageType } from './types';

export * from './types';

/** Payload schema per message type. */
export const FLEET_MESSAGE_SCHEMAS: Record<FleetMessageType, Record<string, unknown>> = {
  hello,
  welcome,
  ping,
  pong,
  ack,
  error,
  'server.config': serverConfig,
  'auth.rotate': authRotate,
  'auth.rotated': authRotated,
  // Step 3 (match control) and D13 (admins / skins): proposed by Ready Up,
  // adopted here (ready-up docs/fleet-step3-platform-notes.md §1, §10).
  'match.assign': matchAssign,
  'match.update': matchUpdate,
  'match.unassign': matchUnassign,
  'cmd': cmd,
  'cmd.result': cmdResult,
  'state.request': stateRequest,
  'state.snapshot': stateSnapshot,
  'state.patch': statePatch,
  'server.availability': serverAvailability,
  'admins.set': adminsSet,
  'skins.loadout': skinsLoadout,
  'skins.invalidate': skinsInvalidate,
  'skins.stattrak': skinsStattrak,
  'event.player_connect': eventPlayerConnect,
  'event.player_disconnect': eventPlayerDisconnect,
  'event.player_team': eventPlayerTeam,
  'event.player_ready': eventPlayerReady,
  'event.player_unready': eventPlayerUnready,
  'event.phase': eventPhase,
  'event.knife_result': eventKnifeResult,
  'event.side_picked': eventSidePicked,
  'event.round_start': eventRoundStart,
  'event.round_end': eventRoundEnd,
  'event.backup': eventBackup,
  'event.pause': eventPause,
  'event.halftime': eventHalftime,
  'event.overtime': eventOvertime,
  'event.rounds_voided': eventRoundsVoided,
  'event.map_result': eventMapResult,
  'event.series_end': eventSeriesEnd,
  'event.demo': eventDemo,
  'event.match_restored': eventMatchRestored,
  'event.forfeit': eventForfeit,
  'event.gg': eventGg,
  'event.admin_called': eventAdminCalled,
  'event.error': eventError,
  // Demo streaming (FLEET.md §12.2): proposed by Ready Up, received by ../../demoStream.ts.
  'demo.begin': demoBegin,
  'demo.chunk': demoChunk,
  'demo.end': demoEnd,
  'demo.ack': demoAck,
};

export const FLEET_SCHEMAS = {
  defs,
  matchDefs,
  envelope,
  messages: FLEET_MESSAGE_SCHEMAS,
  http: { enrollRequest, enrollResponse },
} as const;

export interface ValidationResult {
  ok: boolean;
  /** Short, human-readable reasons (`/payload/host/game_port must be <= 65535`). */
  errors: string[];
}

function describe(errors: ErrorObject[] | null | undefined, prefix = ''): string[] {
  return (errors ?? [])
    .slice(0, 10)
    .map((e) => `${prefix + e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
}

let compiled: {
  envelope: ValidateFunction;
  messages: Map<string, ValidateFunction>;
  enrollRequest: ValidateFunction;
  enrollResponse: ValidateFunction;
} | null = null;

function validators() {
  if (compiled) return compiled;
  // allowUnionTypes: match.defs.json's `cvars` values are `["string", "number", "boolean"]`.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  ajv.addSchema(defs);
  ajv.addSchema(matchDefs);
  const messages = new Map<string, ValidateFunction>();
  for (const [type, schema] of Object.entries(FLEET_MESSAGE_SCHEMAS)) {
    messages.set(type, ajv.compile(schema));
  }
  compiled = {
    envelope: ajv.compile(envelope),
    messages,
    enrollRequest: ajv.compile(enrollRequest),
    enrollResponse: ajv.compile(enrollResponse),
  };
  return compiled;
}

export function isKnownMessageType(type: string): type is FleetMessageType {
  return Object.prototype.hasOwnProperty.call(FLEET_MESSAGE_SCHEMAS, type);
}

export function validateEnvelope(value: unknown): ValidationResult {
  const v = validators().envelope;
  const ok = v(value) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors) };
}

/** Validate a payload against its type's schema. An unknown type fails with `unknown type`. */
export function validatePayload(type: string, payload: unknown): ValidationResult {
  const v = validators().messages.get(type);
  if (!v) return { ok: false, errors: [`unknown type ${type}`] };
  const ok = v(payload) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors, '/payload') };
}

/** Envelope and payload in one go (tests, and the gateway's outbound self-check). */
export function validateMessage(value: unknown): ValidationResult {
  const env = validateEnvelope(value);
  if (!env.ok) return env;
  const msg = value as Envelope;
  return validatePayload(msg.type, msg.payload);
}

export function validateEnrollRequest(value: unknown): ValidationResult {
  const v = validators().enrollRequest;
  const ok = v(value) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors) };
}

export function validateEnrollResponse(value: unknown): ValidationResult {
  const v = validators().enrollResponse;
  const ok = v(value) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors) };
}
