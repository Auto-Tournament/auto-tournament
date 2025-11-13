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
 * Fallback for insecure contexts (non-HTTPS/localhost)
 */
export async function copyTeamMatchUrl(teamId: string): Promise<boolean> {
  try {
    const url = getTeamMatchUrl(teamId);
    
    // Modern Clipboard API (requires secure context)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
    
    // Fallback for insecure contexts
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      document.body.removeChild(textArea);
      console.error('Fallback copy failed:', err);
      return false;
    }
  } catch (error) {
    console.error('Failed to copy team link:', error);
    return false;
  }
}
