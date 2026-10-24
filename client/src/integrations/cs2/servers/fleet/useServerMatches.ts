/**
 * Which match each Ready Up server is playing, with what the tiles show of it:
 * the teams, the map score, the map and how far the series is. The server →
 * match pairs come from the allocation status; each match is read once and
 * again when the socket says it changed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useSocket } from '../../../../module-sdk';
import type { ServerAllocationInfo } from '../../cs2.types';
import { toServerMatch, type MatchResponse, type ServerMatch } from './serverMatchPhase';

export type { ServerMatch };

/** Fleet server id → the match on it, for the servers `useServerAvailability` answered. */
export function useServerMatches(
  servers: readonly ServerAllocationInfo[] | undefined
): Record<string, ServerMatch> {
  const socket = useSocket();
  const [matches, setMatches] = useState<Record<string, ServerMatch | null>>({});
  const wanted = useRef<Set<string>>(new Set());

  // Keyed on content: an availability reload with the same pairs must not refetch every match.
  const pairsKey = (servers ?? [])
    .filter((s) => s.matchSlug && !s.allocatable)
    .map((s) => `${s.id}:${s.matchSlug}`)
    .sort()
    .join('\n');
  const slugByServer = useMemo(() => {
    const next: Record<string, string> = {};
    for (const s of servers ?? []) if (s.matchSlug && !s.allocatable) next[s.id] = s.matchSlug;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsKey]);

  const loadMatch = useCallback(async (slug: string) => {
    try {
      const res = await api.get<MatchResponse>(`/api/matches/${encodeURIComponent(slug)}`);
      if (res.success && res.match) {
        const m = res.match.status === 'completed' ? null : toServerMatch(res.match);
        setMatches((prev) => ({ ...prev, [slug]: m }));
      }
    } catch {
      // Left without details; the tile still says it is in a match.
    }
  }, []);

  useEffect(() => {
    const slugs = new Set(Object.values(slugByServer));
    wanted.current = slugs;
    const id = setTimeout(() => {
      for (const slug of slugs) void loadMatch(slug);
    }, 0);
    return () => clearTimeout(id);
  }, [slugByServer, loadMatch]);

  // A match on a server changed: read it again. Which server holds which match is
  // the availability's to re-read.
  useEffect(() => {
    const onMatch = (data: { slug?: string } | undefined) => {
      if (data?.slug && wanted.current.has(data.slug)) void loadMatch(data.slug);
    };
    socket.on('match:update', onMatch);
    return () => {
      socket.off('match:update', onMatch);
    };
  }, [socket, loadMatch]);

  const out: Record<string, ServerMatch> = {};
  for (const [serverId, slug] of Object.entries(slugByServer)) {
    if (matches[slug] === null) continue;
    out[serverId] = matches[slug] ?? {
      slug,
      team1: '',
      team2: '',
      score: null,
      series: null,
      map: null,
      mapNumber: null,
      maps: 0,
      phase: null,
    };
  }
  return out;
}
