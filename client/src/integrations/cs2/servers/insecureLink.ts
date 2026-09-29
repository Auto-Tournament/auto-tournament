/**
 * The `csm link` / `ru fleet enroll` commands shown to admins use the URL the
 * admin has open. When that is plain http:// (a platform on http://ip:port),
 * csm and Ready Up refuse it unless the admin opts in with `--insecure`, so
 * the command carries the flag, and the dialog notes that the token then
 * travels unencrypted.
 */
export function platformIsPlainHttp(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'http:';
}

/** " --insecure" on a plain-http site, else "". */
export function insecureFlag(): string {
  return platformIsPlainHttp() ? ' --insecure' : '';
}
