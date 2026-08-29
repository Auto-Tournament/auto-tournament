import { copyTextToClipboard } from './clipboard';

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
 * Copy team match URL to clipboard.
 *
 * Works over plain HTTP too — see `copyTextToClipboard`.
 */
export async function copyTeamMatchUrl(teamId: string): Promise<boolean> {
  try {
    return await copyTextToClipboard(getTeamMatchUrl(teamId));
  } catch (error) {
    console.error('Failed to copy team link:', error);
    return false;
  }
}
