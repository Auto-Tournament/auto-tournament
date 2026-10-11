/* global fetch, AbortSignal */
import semver from 'semver';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

const REPOSITORY = 'sivertio/auto-tournament-recorder';
let expires = 0;
let checking: Promise<void> | null = null;

/** One registry check per platform, shared across admin visits and refreshes. */
export async function refreshRecorderRelease(): Promise<void> {
  if (checking) return checking;
  if (Date.now() < expires) return;
  checking = (async () => {
    expires = Date.now() + 60_000;
    const results = await Promise.allSettled([refreshRecorderImage(), refreshRecorderAgent()]);
    for (const result of results)
      if (result.status === 'rejected')
        log.warn('[RECORDER UPDATE] release check failed', { error: result.reason });
    if (results.every((result) => result.status === 'fulfilled')) expires = Date.now() + 5 * 60_000;
  })().finally(() => {
    checking = null;
  });
  return checking;
}
async function refreshRecorderImage(): Promise<void> {
  const tokenResponse = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPOSITORY}:pull`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!tokenResponse.ok) throw new Error(`Registry authentication HTTP ${tokenResponse.status}`);
  const auth = (await tokenResponse.json()) as { token: string };
  const response = await fetch(`https://registry-1.docker.io/v2/${REPOSITORY}/manifests/next`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
    },
  });
  const digest = response.headers.get('Docker-Content-Digest');
  if (!response.ok || !digest || !/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error(`Invalid recorder release metadata (HTTP ${response.status})`);
  await db.runAsync('UPDATE cs2_recorders SET latest_image = ?', [`${REPOSITORY}@${digest}`]);
}
async function refreshRecorderAgent(): Promise<void> {
  const releases = await fetch(
    'https://api.github.com/repos/Auto-Tournament/auto-tournament/releases?per_page=100',
    { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/vnd.github+json' } }
  );
  if (!releases.ok) throw new Error(`Host release metadata HTTP ${releases.status}`);
  const rows = (await releases.json()) as {
    tag_name: string;
    draft: boolean;
    assets: { name: string; digest?: string; browser_download_url: string }[];
  }[];
  const release = rows
    .filter(
      (r) => !r.draft && /^at-recorder-v[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?$/.test(r.tag_name)
    )
    .sort((a, b) =>
      semver.rcompare(
        a.tag_name.slice('at-recorder-v'.length),
        b.tag_name.slice('at-recorder-v'.length)
      )
    )[0];
  const asset = release?.assets.find((a) => a.name === 'at-recorder-linux-amd64.tar.gz');
  if (
    release &&
    asset &&
    /^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '') &&
    asset.browser_download_url ===
      `https://github.com/Auto-Tournament/auto-tournament/releases/download/${release.tag_name}/at-recorder-linux-amd64.tar.gz`
  ) {
    await db.runAsync(
      'UPDATE cs2_recorders SET latest_agent_version = ?, latest_agent_url = ?, latest_agent_sha = ?',
      [
        release.tag_name.slice('at-recorder-v'.length),
        asset.browser_download_url,
        asset.digest!.slice(7),
      ]
    );
  }
}

export function newerRecorderAgent(latest: string | null, installed: string | null): boolean {
  return !!(
    latest &&
    installed &&
    semver.valid(latest) &&
    semver.valid(installed) &&
    semver.gt(latest, installed)
  );
}

export async function acknowledgeRecorderUpdate(
  name: string,
  body: {
    id: string;
    status: string;
    image?: string;
    revision?: string;
    agentVersion?: string;
    error?: string;
  }
): Promise<boolean> {
  const { id, status, image, revision, agentVersion, error: updateError } = body;
  const result = await db.runAsync(
    `UPDATE cs2_recorders SET update_status = ?, update_error = ?, recorder_image = COALESCE(?, recorder_image), recorder_revision = COALESCE(?, recorder_revision), agent_version = COALESCE(?,agent_version), update_seen = EXTRACT(EPOCH FROM NOW())::INTEGER, updated_at = CASE WHEN ? = 'current' THEN EXTRACT(EPOCH FROM NOW())::INTEGER ELSE updated_at END
       WHERE name = ? AND (update_id = ? OR (update_id IS NULL AND ? = '' AND update_protocol IS DISTINCT FROM 1)) AND (update_status IN ('queued', 'updating') OR update_status = ?)
       AND (? <> 'current' OR (update_target = ? AND (update_agent_version IS NULL OR update_agent_version = ?)))`,
    [
      status,
      typeof updateError === 'string' ? updateError.slice(0, 1000) : null,
      image ?? null,
      typeof revision === 'string' ? revision.slice(0, 80) : null,
      typeof agentVersion === 'string' ? agentVersion.slice(0, 80) : null,
      status,
      name,
      id,
      id,
      status,
      status,
      image ?? null,
      typeof agentVersion === 'string' ? agentVersion : null,
    ]
  );
  return result.changes > 0;
}

/** An unacknowledged request never mutated the host and can expire safely. */
export async function expireRecorderUpdateRequests(): Promise<void> {
  await db.runAsync(`UPDATE cs2_recorders SET update_status='failed', update_error='Host did not acknowledge the update within 15 minutes; its running container was preserved'
    WHERE update_status='queued' AND update_requested_at < EXTRACT(EPOCH FROM NOW()) - 900 AND update_seen IS NULL`);
}
