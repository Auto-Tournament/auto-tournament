/**
 * Which match each Ready Up server is playing, with what the tiles show of it:
 * the teams, the map score, the map and how far the series is. The server →
 * match pairs come from the allocation status; each match is read once and
 * again when the socket says it changed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useSocket } from '../../../../module-sdk';

export interface ServerMatch {
  slug: string;
  team1: string;
  team2: string;
  score: [number, number] | null;
  map: string | null;
  mapNumber: number | null;
  maps: number;
  phase: 'veto' | 'warmup' | 'knife' | 'live' | 'post' | null;
}

interface MatchResponse {
  success: boolean;
  match?: {
    slug: string;
    team1?: { name?: string } | null;
    team2?: { name?: string } | null;
    team1MapScore?: number | null;
    team2MapScore?: number | null;
    currentMap?: string | null;
    mapNumber?: number | null;
    maps?: string[];
    matchPhase?: string | null;
    vetoing?: boolean;
    vetoCompleted?: boolean;
  };
}

interface Availability {
  success: boolean;
  servers?: Array<{ id: string; matchSlug: string | null }>;
}

const REFRESH_MS = 30_000;

function toServerMatch(m: NonNullable<MatchResponse['match']>): ServerMatch {
  const phase = m.vetoing || m.vetoCompleted === false
    ? 'veto'
    : m.matchPhase === 'warmup' || m.matchPhase === 'knife' || m.matchPhase === 'live'
      ? m.matchPhase
      : m.matchPhase === 'post_match'
        ? 'post'
        : null;
  const s1 = m.team1MapScore;
  const s2 = m.team2MapScore;
  return {
    slug: m.slug,
    team1: m.team1?.name ?? '',
    team2: m.team2?.name ?? '',
    score: typeof s1 === 'number' && typeof s2 === 'number' ? [s1, s2] : null,
    map: m.currentMap ?? null,
    mapNumber: typeof m.mapNumber === 'number' ? m.mapNumber : null,
    maps: m.maps?.length ?? 0,
    phase,
  };
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
    const timer = setInterval(() => void loadAvailability(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadAvailability]);

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
    out[serverId] = matches[slug] ?? { slug, team1: '', team2: '', score: null, map: null, mapNumber: null, maps: 0, phase: null };
  }
  return out;
}
