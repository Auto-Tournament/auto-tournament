/**
 * Which match each Ready Up server is playing, with what the tiles show of it:
 * the teams, the map score, the map and how far the series is. The server →
 * match pairs come from the allocation status; each match is read once and
 * again when the socket says it changed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useSocket, useTopic } from '../../../../module-sdk';
import { toServerMatch, type MatchResponse, type ServerMatch } from './serverMatchPhase';

export type { ServerMatch };

interface Availability {
  success: boolean;
  servers?: Array<{ id: string; matchSlug: string | null }>;
}

/** Fleet server id → the match on it. */
export function useServerMatches(): Record<string, ServerMatch> {
  const socket = useSocket();
  const [slugByServer, setSlugByServer] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<Record<string, ServerMatch>>({});
  const wanted = useRef<Set<string>>(new Set());

  const loadAvailability = useCallback(async () => {
    try {
      const res = await api.get<Availability>('/api/tournament/server-availability');
      const next: Record<string, string> = {};
      for (const s of res.servers ?? []) if (s.matchSlug) next[s.id] = s.matchSlug;
      setSlugByServer(next);
    } catch {
      // No tournament or no access: no matches to show.
    }
  }, []);

  const loadMatch = useCallback(async (slug: string) => {
    try {
      const res = await api.get<MatchResponse>(`/api/matches/${encodeURIComponent(slug)}`);
      if (res.success && res.match) {
        const m = toServerMatch(res.match);
        setMatches((prev) => ({ ...prev, [slug]: m }));
      }
    } catch {
      // Left without details; the tile still says it is in a match.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void loadAvailability(), 0);
    return () => clearTimeout(first);
  }, [loadAvailability]);
  // Which match is on which server changes with the fleet and the matches.
  useTopic('fleet', loadAvailability, { admin: true, events: ['match:update', 'bracket:update'] });

  useEffect(() => {
    const slugs = new Set(Object.values(slugByServer));
    wanted.current = slugs;
    const id = setTimeout(() => {
      for (const slug of slugs) void loadMatch(slug);
    }, 0);
    return () => clearTimeout(id);
  }, [slugByServer, loadMatch]);

  useEffect(() => {
    const onMatch = (data: { slug?: string } | undefined) => {
      if (data?.slug && wanted.current.has(data.slug)) void loadMatch(data.slug);
      else void loadAvailability();
    };
    const onBracket = () => void loadAvailability();
    socket.on('match:update', onMatch);
    socket.on('bracket:update', onBracket);
    return () => {
      socket.off('match:update', onMatch);
      socket.off('bracket:update', onBracket);
    };
  }, [socket, loadMatch, loadAvailability]);

  const out: Record<string, ServerMatch> = {};
  for (const [serverId, slug] of Object.entries(slugByServer)) {
    out[serverId] = matches[slug] ?? {
      slug,
      team1: '',
      team2: '',
      score: null,
      map: null,
      mapNumber: null,
      maps: 0,
      phase: null,
    };
  }
  return out;
}
