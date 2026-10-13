/**
 * What CS2 adds to the site search (GameIntegration.siteSearch): highlights by
 * player and by team, highlights on a map, and for admins the maps, the game
 * servers and machines, and the recorders. Core ranks (its fuzzy `rank`) and
 * merges the hits with its own.
 */
import { db } from '../../config/database';
import type { GameIntegration, SiteSearchHit } from '../types';

type SearchCtx = Parameters<NonNullable<GameIntegration['siteSearch']>>[0];

const PER_GROUP = 4;
const enc = encodeURIComponent;

const json = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export async function cs2SiteSearch({ admin, rank }: SearchCtx): Promise<SiteSearchHit[]> {
  const hits: SiteSearchHit[] = [];

  // Highlights: a player's clips, a team's, the clips on a map.
  const players = await db.queryAsync<{ id: string; name: string | null; clips: number }>(
    `SELECT h.player_id AS id, p.name, COUNT(*)::int AS clips
       FROM cs2_highlights h JOIN players p ON p.id = h.player_id
      WHERE h.status = 'done' AND h.clip_path IS NOT NULL AND p.deleted_at IS NULL AND p.banned_at IS NULL
      GROUP BY h.player_id, p.name`
  );
  for (const { item, score } of rank(players, (p) => [p.name ?? ''], PER_GROUP)) {
    hits.push({
      group: 'highlights',
      key: `player-${item.id}`,
      label: item.name ?? item.id,
      count: item.clips,
      to: `/highlights?player=${enc(item.id)}`,
      score,
    });
  }
  const teams = await db.queryAsync<{ id: string; name: string }>(
    `SELECT DISTINCT t.id, t.name FROM teams t
      WHERE EXISTS (SELECT 1 FROM cs2_team_reels r WHERE r.team_id = t.id AND r.status = 'done')
         OR EXISTS (SELECT 1 FROM matches m JOIN cs2_highlights h ON h.match_slug = m.slug
                     WHERE (m.team1_id = t.id OR m.team2_id = t.id) AND h.status = 'done')`
  );
  for (const { item, score } of rank(teams, (t) => [t.name], PER_GROUP)) {
    hits.push({
      group: 'highlights',
      key: `team-${item.id}`,
      label: item.name,
      to: `/highlights?team=${enc(item.id)}`,
      score,
    });
  }
  const maps = await db.queryAsync<{ id: string; name: string; clips: number }>(
    `SELECT mp.id, mp.display_name AS name,
            (SELECT COUNT(*)::int FROM cs2_highlights h
               JOIN cs2_demo_jobs j ON j.match_slug = h.match_slug AND j.map_number = h.map_number
              WHERE j.map_name = mp.id AND h.status = 'done') AS clips
       FROM cs2_maps mp`
  );
  const mapFields = (m: { id: string; name: string }) => [
    m.name,
    { text: m.id.replace(/^(de|cs|ar|aim|workshop)_/, ''), weight: 0.9 },
    { text: m.id, weight: 0.9 },
  ];
  for (const { item, score } of rank(
    maps.filter((m) => m.clips > 0),
    mapFields,
    PER_GROUP
  )) {
    hits.push({
      group: 'highlights',
      key: `map-${item.id}`,
      label: item.name,
      count: item.clips,
      to: `/highlights?map=${enc(item.id)}`,
      score,
    });
  }
  if (!admin) return hits;

  for (const { item, score } of rank(maps, mapFields, PER_GROUP)) {
    hits.push({
      group: 'maps',
      key: item.id,
      label: item.name,
      detail: item.id,
      to: '/manage/maps',
      score,
    });
  }

  const servers = await db.queryAsync<{ id: string; name: string; host: string | null }>(
    "SELECT id, name, host FROM cs2_fleet_servers WHERE status <> 'revoked'"
  );
  const machines = await db.queryAsync<{ id: string; name: string; hostname: string | null }>(
    "SELECT id, name, hostname FROM cs2_fleet_hosts WHERE status <> 'revoked'"
  );
  const serverRows = [
    ...servers.map((s) => {
      const host = json<{ hostname?: string; public_addr?: string }>(s.host);
      return {
        key: `server-${s.id}`,
        name: s.name,
        detail: host?.hostname || host?.public_addr || '',
      };
    }),
    ...machines.map((m) => ({ key: `machine-${m.id}`, name: m.name, detail: m.hostname ?? '' })),
  ];
  for (const { item, score } of rank(
    serverRows,
    (s) => [s.name, { text: s.detail, weight: 0.8 }],
    PER_GROUP
  )) {
    hits.push({
      group: 'servers',
      key: item.key,
      label: item.name,
      detail: item.detail || undefined,
      to: '/manage/servers',
      score,
    });
  }

  const recorders = await db.queryAsync<{ name: string; gpu: string | null }>(
    'SELECT name, gpu FROM cs2_recorders'
  );
  for (const { item, score } of rank(
    recorders,
    (r) => [r.name, { text: r.gpu ?? '', weight: 0.7 }],
    PER_GROUP
  )) {
    hits.push({
      group: 'recorders',
      key: item.name,
      label: item.name,
      detail: item.gpu ?? undefined,
      to: '/manage/highlights?tab=cs2&sub=recorders',
      score,
    });
  }
  return hits;
}
