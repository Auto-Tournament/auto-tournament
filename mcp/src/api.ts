/** The platform's API with an API token, and the shapes the tools hand back. */

const MAX_TEXT = 60_000;

export class ApiClient {
  private readonly base: string;

  constructor(
    url: string,
    private readonly token: string
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  async send(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<unknown> {
    return this.request(method, path, body);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await res.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `${res.status} ${res.statusText}`;
      throw new Error(`${method} ${path}: ${res.status}: ${message}`);
    }
    return parsed;
  }

  /** JSON for the client, cut short when it is huge. */
  static show(value: unknown): string {
    const out = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return out.length > MAX_TEXT
      ? `${out.slice(0, MAX_TEXT)}\n… (${out.length - MAX_TEXT} more characters; ask for less)`
      : out;
  }

  /** The installed modules from the catalog: id, name, state. */
  static modules(catalog: unknown): unknown {
    const items = (catalog as { items?: Array<Record<string, unknown>> })?.items;
    if (!Array.isArray(items)) return catalog;
    return items
      .filter((i) => i.kind === 'module')
      .map((i) => ({ id: i.id, name: i.name, state: i.state, reason: i.reason ?? null }));
  }

  /** One line per match. */
  static matchLine(m: Record<string, unknown>): Record<string, unknown> {
    const team = (t: unknown) => (t && typeof t === 'object' ? (t as { name?: unknown }).name : t);
    return {
      slug: m.slug,
      status: m.status,
      round: m.round,
      team1: team(m.team1),
      team2: team(m.team2),
      score: [m.team1Score ?? null, m.team2Score ?? null],
      server: m.serverId ?? null,
    };
  }

  /** Machines with their servers, without the noise. */
  static hosts(body: unknown): unknown {
    const hosts = (body as { hosts?: Array<Record<string, unknown>> })?.hosts;
    if (!Array.isArray(hosts)) return body;
    return hosts.map((h) => ({
      id: h.id,
      name: h.name,
      online: h.online,
      csm: h.csmVersion ?? null,
      servers: (Array.isArray(h.servers) ? (h.servers as Array<Record<string, unknown>>) : []).map(
        (s) => ({
          name: s.name,
          port: s.game_port,
          running: (s.process as { running?: unknown } | undefined)?.running ?? null,
          readyUp: (s.readyup as { installed?: unknown } | undefined)?.installed ?? null,
          phase: (s.readyup as { phase?: unknown } | undefined)?.phase ?? null,
          fleetServer: (s.fleetServer as { id?: unknown } | undefined)?.id ?? null,
        })
      ),
    }));
  }

  /** Fleet servers: id, name, online, availability, version, linked row. */
  static fleetServers(body: unknown): unknown {
    const servers = (body as { servers?: Array<Record<string, unknown>> })?.servers;
    if (!Array.isArray(servers)) return body;
    return servers.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      online: s.online,
      availability: s.availability,
      readyUp: (s.readyUpUpdate as { running?: unknown; state?: unknown } | undefined) ?? null,
      linkedServerId: s.linkedServerId ?? null,
    }));
  }
}
