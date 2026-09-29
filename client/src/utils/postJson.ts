/**
 * POST JSON and read the answer whatever the status: the setup and local
 * admin login pages branch on the status and on fields of an error body
 * (`totpRequired`, `problem`), which `api.post` would throw away.
 */
export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown
): Promise<{ status: number; data: T & { success?: boolean; error?: string } }> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  let data = {} as T & { success?: boolean; error?: string };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    // Not JSON (a proxy error page): the status says enough.
  }
  return { status: response.status, data };
}
