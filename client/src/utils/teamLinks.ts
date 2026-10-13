import { copyTextToClipboard } from './clipboard';
import { teamProfilePath } from '../paths';

/**
 * Team link utilities: the team's page, shared with its players. It shows
 * the team's next match, a link to the match room where it is played.
 */

/** The full address of a team's page, to share. */
export function getTeamPageUrl(teamId: string): string {
  return `${window.location.origin}${teamProfilePath(teamId)}`;
}

/** Path to a team's page (roster, ratings, its next match). */
export function getTeamProfileUrl(teamId: string): string {
  return teamProfilePath(teamId);
}

/**
 * Copy a team's page address to the clipboard.
 *
 * Works over plain HTTP too — see `copyTextToClipboard`.
 */
export async function copyTeamPageUrl(teamId: string): Promise<boolean> {
  try {
    return await copyTextToClipboard(getTeamPageUrl(teamId));
  } catch (error) {
    console.error('Failed to copy team link:', error);
    return false;
  }
}
