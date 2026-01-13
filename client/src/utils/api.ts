/**
 * API utility functions
 *
 * Uses relative paths (/api/*) which work in both environments:
 * - Development: Vite proxy forwards /api/* → localhost:3000
 * - Production: Caddy proxy forwards /api/* → localhost:3000 (internal)
 *
 * All API calls should use '/api' prefix (e.g., '/api/servers', '/api/teams')
 */

export const api = {
  /**
   * Make an authenticated API request
   */
  async fetch(endpoint: string, options: RequestInit = {}) {
    const { headers, ...rest } = options;
    const response = await fetch(endpoint, {
      // Always send cookies (admin session + player cookie) by default so
      // admin-only routes like /api/maps work correctly. Callers can still
      // override this by passing credentials in options if needed.
      credentials: options.credentials ?? 'include',
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `API request failed: ${response.status}`);
    }

    return response.json();
  },

  /**
   * GET request
   */
  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.fetch(endpoint, { method: 'GET' });
  },

  /**
   * POST request
   */
  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.fetch(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  /**
   * PUT request
   */
  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.fetch(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  /**
   * PATCH request
   */
  async patch<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.fetch(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  /**
   * DELETE request
   */
  async delete(endpoint: string) {
    return this.fetch(endpoint, { method: 'DELETE' });
  },

};
