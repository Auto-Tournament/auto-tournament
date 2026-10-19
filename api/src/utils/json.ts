/**
 * Data that goes out as JSON unchanged: a response field, a log summary, a
 * JSON Schema. Values the platform builds, so they are typed; a value with a
 * fixed shape should use its own interface instead.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue | undefined };
