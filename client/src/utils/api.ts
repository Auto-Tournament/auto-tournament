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
      // Send cookies for same-origin requests by default so admin-only routes
      // like /api/maps work correctly. The app is served from the same origin
      // (via Caddy/Vite proxy), so 'same-origin' is appropriate and more secure
      // than 'include' which would send cookies on cross-origin requests.
      // Callers can still override this if needed (e.g., set credentials: 'include'
      // for cross-origin requests) by passing credentials in options.
      credentials: options.credentials ?? 'same-origin',
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
