/**
 * Team link utilities
 * Centralized logic for generating and handling team match URLs
 */

/**
 * Generate team match URL
 */
export function getTeamMatchUrl(teamId: string): string {
  return `${window.location.origin}/team/${teamId}`;
}

/**
 * Copy team match URL to clipboard
 */
export async function copyTeamMatchUrl(teamId: string): Promise<boolean> {
  try {
    const url = getTeamMatchUrl(teamId);
    await navigator.clipboard.writeText(url);
    return true;
  } catch (error) {
    console.error('Failed to copy team link:', error);
    return false;
  }
}

/**
 * Open team match page in new tab
 */
export function openTeamMatchInNewTab(teamId: string): void {
  const url = getTeamMatchUrl(teamId);
  window.open(url, '_blank', 'noopener,noreferrer');
}

