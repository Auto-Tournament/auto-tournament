/**
 * The fleet protocol v1 schemas, loaded, and a validator over them.
 *
 * The `*.json` files next to this are the contract (FLEET.md D18): Ready Up
 * and csm copy them. This file only wires them into ajv (draft 2020-12).
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import defs from './defs.json';
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
};

export const FLEET_SCHEMAS = {
  defs,
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
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addSchema(defs);
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
