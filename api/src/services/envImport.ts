/**
 * Which environment variables have been imported into the database already
 * (app_settings `env_imported`, a JSON array of names). A variable is
 * imported once; after that the value saved in Settings is the source of
 * truth, even if the admin clears it.
 */
import { db } from '../config/database';

const KEY = 'env_imported';

export async function envImportedNames(): Promise<Set<string>> {
  const raw = await db.getAppSettingAsync(KEY);
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export async function markEnvImported(names: string[]): Promise<void> {
  if (names.length === 0) return;
  const seen = await envImportedNames();
  for (const n of names) seen.add(n);
  await db.setAppSettingAsync(KEY, JSON.stringify([...seen].sort()));
}
