/**
 * The `?next=` param on `/welcome/games`: where to send the player once they
 * pick their games (or skip). Only a same-origin relative path is ever
 * accepted — never a full URL — so a crafted link cannot use this page to
 * bounce a signed-in player off-site.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  // Must start with exactly one '/': "//evil.example" is protocol-relative
  // (redirects off-site in a browser), and anything without a leading slash
  // could be interpreted as a scheme (e.g. "javascript:...").
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}
