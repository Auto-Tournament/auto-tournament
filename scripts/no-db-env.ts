/**
 * Import this first in tooling scripts that load API modules but must never
 * open a database connection. ESM evaluates imports in order, so this runs
 * before `api/src/config/database` is loaded.
 */
process.env.AT_NO_DB = '1';
