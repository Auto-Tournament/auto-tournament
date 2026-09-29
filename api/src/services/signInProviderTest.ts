/**
 * The "Test" button on Settings -> Sign-in: check a provider's credentials
 * against the provider without a user in the loop.
 *
 *  - Steam: a Web API call with the key (steamService's key check).
 *  - Discord, Twitch: a client-credentials token request; only a valid client
 *    id and secret get a token.
 *  - Google, GitHub: an authorization-code exchange with a code that cannot be
 *    valid. The provider checks the client first, so "bad code" means the id
 *    and secret are good and "bad client" means they are not.
 *
 * Tokens that come back are thrown away. Nothing here logs a secret or the
 * provider's response body; the caller gets a result code only.
 */
import { effectiveProviderSettings, type SignInProviderId } from '../config/signInProviders';
import { steamService } from './steamService';

export type ProviderTestResult =
  | 'ok'
  | 'invalid_credentials'
  | 'unreachable'
  | 'not_configured'
  | 'not_supported'
  | 'unexpected';

export interface ProviderTestOutcome {
  result: ProviderTestResult;
  /** HTTP status from the provider, when there was one. */
  status?: number;
}

const TIMEOUT_MS = 8000;
const INVALID_CODE = 'auto-tournament-connection-test';

async function post(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  return globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body: new globalThis.URLSearchParams(body).toString(),
    signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function errorCode(response: Awaited<ReturnType<typeof globalThis.fetch>>): Promise<string | undefined> {
  try {
    const json = (await response.json()) as { error?: unknown };
    return typeof json.error === 'string' ? json.error : undefined;
  } catch {
    return undefined;
  }
}

export async function testSignInProvider(id: SignInProviderId, callbackUrl: string): Promise<ProviderTestOutcome> {
  const settings = effectiveProviderSettings(id);
  if (id === 'epic') return { result: 'not_supported' };
  if (!settings.configured || !settings.secret) return { result: 'not_configured' };

  if (id === 'steam') {
    steamService.resetHealthCache();
    const health = await steamService.checkSteamWebApiHealth({ force: true });
    if (health.ok) return { result: 'ok' };
    if (health.errorType === 'invalid_key') return { result: 'invalid_credentials', status: health.statusCode };
    if (health.errorType === 'unreachable') return { result: 'unreachable' };
    if (health.errorType === 'not_configured') return { result: 'not_configured' };
    return { result: 'unexpected', status: health.statusCode };
  }

  const clientId = settings.clientId!;
  const secret = settings.secret;
  try {
    if (id === 'discord') {
      const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
      const response = await post(
        'https://discord.com/api/oauth2/token',
        { grant_type: 'client_credentials', scope: 'identify' },
        { Authorization: `Basic ${basic}` }
      );
      if (response.ok) return { result: 'ok' };
      if (response.status === 401 || (await errorCode(response)) === 'invalid_client') {
        return { result: 'invalid_credentials', status: response.status };
      }
      return { result: 'unexpected', status: response.status };
    }

    if (id === 'twitch') {
      const response = await post('https://id.twitch.tv/oauth2/token', {
        client_id: clientId,
        client_secret: secret,
        grant_type: 'client_credentials',
      });
      if (response.ok) return { result: 'ok' };
      if (response.status === 400 || response.status === 403) {
        return { result: 'invalid_credentials', status: response.status };
      }
      return { result: 'unexpected', status: response.status };
    }

    if (id === 'google') {
      const response = await post('https://oauth2.googleapis.com/token', {
        client_id: clientId,
        client_secret: secret,
        code: INVALID_CODE,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      });
      const code = await errorCode(response);
      if (code === 'invalid_grant') return { result: 'ok' };
      if (code === 'invalid_client' || code === 'unauthorized_client') {
        return { result: 'invalid_credentials', status: response.status };
      }
      return { result: 'unexpected', status: response.status };
    }

    if (id === 'github') {
      const response = await post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        client_secret: secret,
        code: INVALID_CODE,
      });
      const code = await errorCode(response);
      if (code === 'bad_verification_code') return { result: 'ok' };
      if (code === 'incorrect_client_credentials') {
        return { result: 'invalid_credentials', status: response.status };
      }
      return { result: 'unexpected', status: response.status };
    }
  } catch {
    return { result: 'unreachable' };
  }
  return { result: 'not_supported' };
}
