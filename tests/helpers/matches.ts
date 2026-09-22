import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Match helper functions
 */

export interface Match {
  id: number;
  slug: string;
  team1?: { id: string };
  team2?: { id: string };
  team1_id?: string;
  team2_id?: string;
  status: string;
}

/**
 * Find a match by team IDs
 * @param request Playwright API request context
 * @param team1Id First team ID
 * @param team2Id Second team ID
 * @returns Match or null
 */
export async function findMatchByTeams(
  request: APIRequestContext,
  team1Id: string,
  team2Id: string
): Promise<Match | null> {
  try {
    const response = await request.get('/api/matches', {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    if (!data.matches || !Array.isArray(data.matches)) {
      return null;
    }

    const match = data.matches.find(
      (m: Match) =>
        (m.team1?.id === team1Id && m.team2?.id === team2Id) ||
        (m.team1?.id === team2Id && m.team2?.id === team1Id) ||
        (m.team1_id === team1Id && m.team2_id === team2Id) ||
        (m.team1_id === team2Id && m.team2_id === team1Id)
    );

    return match || null;
  } catch (error) {
    console.error('Match lookup error:', error);
    return null;
  }
}

/**
 * Get match by slug
 * @param request Playwright API request context
 * @param matchSlug Match slug
 * @returns Match or null
 */
export async function getMatchBySlug(
  request: APIRequestContext,
  matchSlug: string
): Promise<Match | null> {
  try {
    const response = await request.get(`/api/matches/${matchSlug}`, {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    return data.match || null;
  } catch (error) {
    console.error('Match fetch error:', error);
    return null;
  }
}
