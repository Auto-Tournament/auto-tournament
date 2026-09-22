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
 * Path to the public team profile page (roster, ratings, current tournament
 * status). Distinct from the team *match* page above — this is the
 * read-only overview anyone can open, not the in-match/server page.
 */
export function getTeamProfileUrl(teamId: string): string {
  return `/t/team/${teamId}`;
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
