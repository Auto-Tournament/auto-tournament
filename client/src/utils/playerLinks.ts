/**
 * Generate URL for a player's profile page
 * @param steamId - Player's Steam ID
 * @returns URL path to player page
 */
export function getPlayerPageUrl(steamId: string): string {
  return `/player/${steamId}`;
}

