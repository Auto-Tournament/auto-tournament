import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Server helper functions
 */

export interface CreateServerInput {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled?: boolean;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

/**
 * Create a server
 * @param request Playwright API request context
 * @param input Server data
 * @returns Created server or null
 */
export async function createServer(
  request: APIRequestContext,
  input: CreateServerInput
): Promise<Server | null> {
  try {
    const response = await request.post('/api/servers', {
      headers: getAuthHeader(),
      data: {
        ...input,
        enabled: input.enabled ?? true,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Server creation failed:', errorText);
      return null;
    }

    const data = await response.json();
    return data.server;
  } catch (error) {
    console.error('Server creation error:', error);
    return null;
  }
}

/**
 * Delete a server
 * @param request Playwright API request context
 * @param serverId Server ID to delete
 * @returns true if successful
 */
export async function deleteServer(request: APIRequestContext, serverId: string): Promise<boolean> {
  try {
    const response = await request.delete(`/api/servers/${serverId}`, {
      headers: getAuthHeader(),
    });
    return response.ok();
  } catch (error) {
    console.error('Server deletion error:', error);
    return false;
  }
}

/**
 * Host used for fake test servers.
 *
 * The API treats 0.0.0.0 as a "fake" server: RCON returns canned responses and
 * status is always online. Any other host makes the tournament-start preflight
 * try a real RCON `version` call, which fails and blocks the tournament with
 * `cs2_outdated_servers`.
 */
export const FAKE_SERVER_HOST = '0.0.0.0';

/**
 * Create a test server
 * @param request Playwright API request context
 * @param prefix Prefix for server name/ID
 * @returns Created server or null
 */
export async function createTestServer(
  request: APIRequestContext,
  prefix: string = 'test'
): Promise<Server | null> {
  const timestamp = Date.now();
  return await createServer(request, {
    id: `${prefix}-server-${timestamp}`,
    name: `${prefix} Server ${timestamp}`,
    host: FAKE_SERVER_HOST,
    port: 27015 + (timestamp % 1000),
    password: 'testpassword123',
    enabled: true,
  });
}
