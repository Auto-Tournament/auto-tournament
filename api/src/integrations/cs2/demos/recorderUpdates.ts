/* global fetch, AbortSignal */
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
    try {
      const tokenResponse = await fetch(
        `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPOSITORY}:pull`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!tokenResponse.ok)
        throw new Error(`Registry authentication HTTP ${tokenResponse.status}`);
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
      expires = Date.now() + 5 * 60_000;
    } catch (error) {
      // Keep the last verified version available if the registry is temporarily down.
      log.warn('[RECORDER UPDATE] release check failed', { error });
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}
