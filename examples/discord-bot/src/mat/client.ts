/**
 * A very small MAT API client.
 *
 * The whole surface a bot needs is "GET a JSON endpoint with a bearer token",
 * so that is all this is. Add methods as you need them; the endpoint list is in
 * docs/API-REFERENCE.md, and docs/openapi.json will generate a full typed
 * client if you would rather not write them.
 */

import type { Config } from '../config.js';
import type { Match, MatchListResponse, MatchResponse } from './types.js';

export class MatApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string
  ) {
    super(message);
    this.name = 'MatApiError';
  }
}

export class MatClient {
  constructor(private readonly config: Config) {}

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.matUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.matApiToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // MAT distinguishes these deliberately, and they need different fixes:
      // 401 means the token is not one MAT knows, 403 means it is read-only and
      // the call tried to write. Saying so here saves reading the API's logs.
      const hint =
        response.status === 401
          ? ' — MAT_API_TOKEN is not configured on that instance'
          : response.status === 403
            ? ' — that token is read-only and this call needs to write'
            : '';
      throw new MatApiError(
        response.status,
        path,
        `GET ${path} failed with ${response.status}${hint}`
      );
    }

    return (await response.json()) as T;
  }

  /** Every match MAT knows about, newest rounds last. */
  async listMatches(): Promise<Match[]> {
    const body = await this.get<MatchListResponse>('/api/matches');
    return body.matches ?? [];
  }

  async getMatch(slug: string): Promise<Match | null> {
    try {
      const body = await this.get<MatchResponse>(`/api/matches/${encodeURIComponent(slug)}`);
      return body.match ?? null;
    } catch (error) {
      if (error instanceof MatApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Check the token before the bot announces itself as ready.
   *
   * Without this the first symptom of a bad token is a user running a command
   * and getting an error, which is a poor way to find out.
   */
  async verifyToken(): Promise<{ label: string; scope: string }> {
    const body = await this.get<{
      authenticated?: boolean;
      serviceToken?: { label?: string; scope?: string };
    }>('/api/auth/admin/me');

    if (!body.authenticated || !body.serviceToken) {
      throw new Error(
        'MAT did not accept MAT_API_TOKEN. Check it against API_TOKENS / ' +
          'API_TOKENS_READONLY on your MAT instance.'
      );
    }

    return {
      label: body.serviceToken.label ?? 'unknown',
      scope: body.serviceToken.scope ?? 'unknown',
    };
  }
}
