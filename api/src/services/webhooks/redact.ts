/**
 * What the delivery log shows of a delivered body.
 *
 * The body sent to the receiver is kept (a retry or a resend sends it again,
 * byte for byte), but the connect details in it — server address, join
 * password, steam:// link — go to the signed delivery only. Anything that
 * shows a body to a person (the admin API's delivery log and the UI on top of
 * it) goes through `redactDeliveryBody`, and the logger never gets a body.
 */

import type { JsonObject, JsonValue } from '../../utils/json';

export const REDACTED = '[redacted]';

function redactConnect(connect: JsonValue | undefined): JsonValue | undefined {
  if (!connect || typeof connect !== 'object' || Array.isArray(connect)) return connect;
  const out: JsonObject = {};
  for (const key of Object.keys(connect)) {
    const value = connect[key];
    out[key] = value === null || value === undefined ? value : REDACTED;
  }
  return out;
}

/** The body as the delivery log shows it: parsed, connect details replaced. */
export function redactDeliveryBody(body: string | null | undefined): JsonValue | undefined {
  if (!body) return null;
  let parsed: JsonValue;
  try {
    // A body we wrote ourselves: JSON.
    parsed = JSON.parse(body) as JsonValue;
  } catch {
    return REDACTED;
  }
  const walk = (value: JsonValue | undefined): JsonValue | undefined => {
    if (Array.isArray(value)) return value.map((v) => walk(v) ?? null);
    if (!value || typeof value !== 'object') return value;
    const out: JsonObject = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = key === 'connect' ? redactConnect(inner) : walk(inner);
    }
    return out;
  };
  return walk(parsed);
}

/** A receiver's response body as stored: at most `max` characters, never binary junk. */
export function truncateResponseBody(text: string, max = 2048): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Connect details in a receiver's echo of our body are scrubbed before storing it. */
export function scrubSecrets(text: string, body: string): string {
  let out = text;
  try {
    const parsed = JSON.parse(body) as {
      data?: { match?: { connect?: Record<string, string | null> | null } };
    };
    const connect = parsed.data?.match?.connect;
    if (connect) {
      // Longest first: the steam:// link and console line contain the host and password.
      const values = Object.values(connect)
        .filter((v): v is string => typeof v === 'string' && v.length >= 4)
        .sort((a, b) => b.length - a.length);
      for (const value of values) out = out.split(value).join(REDACTED);
    }
  } catch {
    // Not JSON: nothing of ours to find in it.
  }
  return out;
}
