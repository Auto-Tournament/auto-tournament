/**
 * API utility functions
 *
 * Uses relative paths (/api/*) which work in both environments:
 * - Development: Vite proxy forwards to localhost:3000
 * - Production: Express serves both frontend and API on same port
 */

const getAuthHeaders = (token?: string): HeadersInit => {
  const authToken = token || localStorage.getItem('api_token');

  if (!authToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
};

export const api = {
  /**
   * Make an authenticated API request
   */
  async fetch(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...options.headers,
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
  async get(endpoint: string) {
    return this.fetch(endpoint, { method: 'GET' });
  },

  /**
   * POST request
   */
  async post(endpoint: string, data: any) {
    return this.fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * PUT request
   */
  async put(endpoint: string, data: any) {
    return this.fetch(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * PATCH request
   */
  async patch(endpoint: string, data: any) {
    return this.fetch(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  /**
   * DELETE request
   */
  async delete(endpoint: string) {
    return this.fetch(endpoint, { method: 'DELETE' });
  },

  /**
   * Verify authentication token
   */
  async verifyToken(token: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
