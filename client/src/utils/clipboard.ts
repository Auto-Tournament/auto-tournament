/**
 * Copying text without a secure context.
 *
 * `navigator.clipboard` only exists on HTTPS and localhost. Plenty of MAT
 * instances run over plain HTTP on a LAN, where the modern API is simply absent
 * — so a button that only calls it does nothing at all, which is exactly what
 * users reported about "Copy Console Command".
 *
 * `document.execCommand('copy')` is deprecated but still works in non-secure
 * contexts in every browser MAT targets, so it is the fallback rather than the
 * last resort. Callers should still handle `false`: a browser may refuse both,
 * and the only honest answer then is to show the text and let the user copy it.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Permission denied or a hostile embedding context — try the old way.
      console.warn('Clipboard API write failed, falling back to execCommand:', error);
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  // Keep it off-screen but still focusable; `display: none` cannot be selected.
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  textArea.setAttribute('readonly', '');
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    return document.execCommand('copy');
  } catch (error) {
    console.error('Fallback copy failed:', error);
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}
