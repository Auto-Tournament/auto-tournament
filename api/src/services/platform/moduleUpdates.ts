/**
 * Tells the admins when a module or game pack has an update, or when one did
 * not take: a notice in every admin's bell (once per version) and the list
 * behind the update toast (GET /api/system/update, UpdateToast).
 *
 * 2026-10-09: cs.sivert.io ran the CS2 module 3.0.0-beta.72 through three
 * platform releases, because each newer module failed to load and was rolled
 * back, and the only place that said so was the Modules page.
 */
import { listCatalog, type CatalogItem } from '../../modules/catalogService';
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { notificationService } from '../notificationService';

/** The admin's Modules page (client paths.modules). */
const MODULES_PAGE = '/manage/modules';

export interface ModuleUpdate {
  kind: 'pack' | 'module';
  id: string;
  name: string;
  installed: string | null;
  /** The version an update would install; null when the note is about one that did not take. */
  available: string | null;
  /** Why the last update did not take (boot's automatic update), when it did not. */
  problem: string | null;
}

/** What the admins should hear about, from the catalog's listing (pure: tested on its own). */
export function moduleUpdatesFrom(items: CatalogItem[]): ModuleUpdate[] {
  const out: ModuleUpdate[] = [];
  for (const item of items) {
    if (!item.installed) continue;
    const update = item.state === 'update-available' ? (item.available?.version ?? null) : null;
    if (!update && !item.notice) continue;
    out.push({
      kind: item.kind,
      id: item.id,
      name: item.name,
      installed: item.installed.version,
      available: update,
      problem: item.notice,
    });
  }
  return out;
}

export async function listModuleUpdates(): Promise<ModuleUpdate[]> {
  try {
    return moduleUpdatesFrom((await listCatalog()).items);
  } catch (error) {
    log.warn('[UPDATES] Could not list module updates', { error: (error as Error).message });
    return [];
  }
}

/** One notice per admin, module and version (a second run sends nothing new). */
export async function notifyAdminsOfModuleUpdates(): Promise<number> {
  const updates = await listModuleUpdates();
  if (updates.length === 0) return 0;
  const admins = (
    await db.queryAsync<{ id: string }>(
      'SELECT id FROM players WHERE is_admin = 1 AND deleted_at IS NULL'
    )
  ).map((r) => r.id);
  if (admins.length === 0) return 0;
  let sent = 0;
  for (const u of updates) {
    const version = u.available ?? u.installed ?? '';
    // A notice is either a failed update or a new major version waiting for the admin.
    const failed = !!u.problem && /did not|failed|could not/i.test(u.problem);
    const title = failed
      ? `${u.name}: the update did not take`
      : `${u.name} ${u.available ?? ''} is available`.replace(/\s+is/, ' is');
    const body =
      u.problem ?? `You run ${u.installed ?? 'an older version'}. Update it on the Modules page.`;
    const key = `${failed ? 'module-problem' : 'module-update'}:${u.kind}:${u.id}:${version}`;
    sent += await notificationService.notifyOnce(
      admins,
      'news',
      { title, body, url: MODULES_PAGE },
      key
    );
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;

/** A minute after boot (the catalog's feed has had time), then every hour. */
export function startModuleUpdateNotices(): void {
  if (timer) return;
  const run = () => void notifyAdminsOfModuleUpdates().catch(() => undefined);
  setTimeout(run, 60_000).unref?.();
  timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
}
