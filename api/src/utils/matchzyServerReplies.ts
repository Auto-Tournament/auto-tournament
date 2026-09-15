/**
 * Parsing for the text MatchZy / CounterStrikeSharp send back over RCON.
 *
 * Kept free of I/O so the classification can be checked without a CS2 server.
 */

/**
 * Read the value out of a convar query reply.
 *
 * MAT used to accept only the Source 1 shape, `"name" = "value"`. The
 * `matchzy_tournament_*` convars are CounterStrikeSharp FakeConVars, which
 * answer a bare query with `name = value` — no quotes — so the old pattern
 * never matched and every server read as idle with no timestamp. Both shapes
 * are accepted here.
 *
 * @returns the value (possibly empty), or null when the reply is not a convar
 *          echo at all (unknown command, empty reply).
 */
export function parseConVarReply(response: string | null | undefined, name?: string): string | null {
  if (!response) return null;

  for (const rawLine of response.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const quoted = line.match(/^"([^"]+)"\s*=\s*"([^"]*)"/);
    if (quoted) {
      if (name && quoted[1] !== name) continue;
      return quoted[2];
    }

    const bare = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
    if (bare) {
      if (name && bare[1] !== name) continue;
      // Engine convars append `( def. "x" )` and flags; FakeConVars do not.
      return bare[2].replace(/\s+\(\s*def\..*$/, '').replace(/^"(.*)"$/, '$1').trim();
    }
  }

  return null;
}

export type LoadMatchReply =
  /** The plugin queued the match to load once the current series finishes resetting. */
  | 'queued'
  /** GOTV is off, so the plugin refused. */
  | 'gotv_inactive'
  /** A match is set up and not in postgame, so the plugin refused. */
  | 'already_setup'
  /** The plugin says the load itself failed. */
  | 'failed'
  /** Nothing recognisable; the config fetch decides whether it loaded. */
  | 'unknown';

/**
 * Classify the RCON reply to `matchzy_loadmatch_url`.
 *
 * The queued reply matters most: while the previous series is in postgame,
 * MatchZy-Enhanced stores the URL and fetches it only after its reset — minutes
 * later. MAT waited 10s for the fetch, called the load failed, and gave the
 * match to another server; the first server then loaded it too, and both
 * servers played the same match.
 *
 * Wordings seen in MatchZy-Enhanced 1.4.24:
 *   "[LoadMatchDataCommand] Current match 13 is finishing. Queued next match from URL: … to load after reset."
 *   "[matchzy match load] Current match 13 is postgame. Queued next match from URL: …"
 * Later versions (MatchZy-Enhanced#16) end the reply with a machine-readable
 * `queued_match=<config name>`, e.g. `queued_match=r2m1`.
 */
export function classifyLoadMatchReply(response: string | null | undefined): LoadMatchReply {
  const text = (response ?? '').toLowerCase();
  if (!text) return 'unknown';

  if (
    /(^|\s)queued_match=\S+/.test(text) ||
    text.includes('queued next match') ||
    text.includes('queuing next match') ||
    text.includes('to load after reset')
  ) {
    return 'queued';
  }
  if (text.includes('gotv[0] not active')) return 'gotv_inactive';
  if (text.includes('cannot load a new match') || text.includes('already setup')) {
    return 'already_setup';
  }
  if (text.includes('match load failed')) return 'failed';
  return 'unknown';
}

export type ClearQueuedReply =
  /** The plugin dropped a queued load. */
  | 'cleared'
  /** The plugin understood the command and had nothing queued. */
  | 'none'
  /** No recognisable answer: a plugin without `matchzy_clear_queued_match`. */
  | 'unsupported';

/**
 * Classify the reply to `matchzy_clear_queued_match` (MatchZy-Enhanced#16+):
 * `cleared_queued_match=<id>`, or `cleared_queued_match=none` when nothing was
 * queued. `css_restart` / `css_endmatch` include the same token.
 */
export function classifyClearQueuedReply(response: string | null | undefined): ClearQueuedReply {
  const match = (response ?? '').match(/cleared_queued_match=(\S+)/i);
  if (!match) return 'unsupported';
  return match[1].toLowerCase() === 'none' ? 'none' : 'cleared';
}
