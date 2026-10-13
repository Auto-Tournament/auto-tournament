/**
 * CS2's share cards (core: services/shareCards): a clip's page shows a frame
 * of the clip itself, a reel's page three of its plays.
 *
 * - /watch/clip/:id                  → clip card
 * - /watch/match/:slug/:map          → match reel
 * - /watch/reel/:slug/:map/:player   → a player's reel of a map
 * - /watch/team/:slug/:team          → a team's reel of a match
 * - /watch/tournament/:id            → the tournament reel
 *
 * The frame is cut from the clip with ffmpeg (in the image) at its slow
 * motion, and kept under DATA_DIR/share-cards/frames by clip and file time.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { DATA_DIR } from '../../config/dataDir';
import type { CardData, CardImage, ShareKind } from '../../services/shareCards/types';
import { clipFile } from './demos/highlights';
import {
  clipView,
  matchReelView,
  playerReelView,
  tournamentReel,
  type ClipView,
} from './demos/highlightViews';
import { teamReelView } from './demos/teamReels';
import { db } from '../../config/database';

const FRAMES_DIR = path.join(DATA_DIR, 'share-cards', 'frames');

const KIND_TAG: Record<string, string> = {
  ace: 'Ace',
  '4k': '4K',
  '3k': '3K',
  '2k': '2K',
  clutch: 'Clutch',
  flair: 'Flair',
  funny: 'Funny',
};

/** "de_mirage" → "Mirage". */
const mapLabel = (name: string | null | undefined) => {
  if (!name) return null;
  const bare = name.replace(/^(de|cs|ar|wm)_/i, '').replace(/_/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
};

function versionOf(...parts: unknown[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url').slice(-16);
}

/** A still of clip `id` (JPEG), at its slow motion or halfway; null when there is no video or ffmpeg. */
export async function clipFrame(id: number, atSeconds: number | null): Promise<CardImage | null> {
  const video = clipFile(id);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(video);
  } catch {
    return null;
  }
  const out = path.join(FRAMES_DIR, `${id}-${Math.floor(stat.mtimeMs)}.jpg`);
  try {
    return { data: fs.readFileSync(out), type: 'image/jpeg' };
  } catch {
    // Not cut yet.
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const at = Math.max(0, atSeconds ?? 1);
  const ok = await new Promise<boolean>((resolve) => {
    execFile(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(at),
        '-i',
        video,
        '-frames:v',
        '1',
        '-vf',
        'scale=1200:-2',
        '-q:v',
        '3',
        out,
      ],
      { timeout: 15_000 },
      (error) => resolve(!error)
    );
  });
  if (!ok) return null;
  try {
    return { data: fs.readFileSync(out), type: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Where in a clip its best moment is: the slow motion, else halfway. */
const momentOf = (clip: ClipView) =>
  clip.markers?.slowmo?.[0] ?? (clip.markers?.duration ? clip.markers.duration / 2 : null);

async function framesOf(
  chapters: { highlightId: number }[] | undefined,
  count = 3
): Promise<CardImage[]> {
  const ids = (chapters ?? []).map((c) => c.highlightId).slice(-count);
  const frames = await Promise.all(
    ids.map(async (id) => {
      const clip = await clipView(id);
      return clip ? clipFrame(id, momentOf(clip)) : null;
    })
  );
  return frames.filter((f): f is CardImage => f !== null);
}

const plays = (n: number) => `${n} play${n === 1 ? '' : 's'}`;
const versus = (a: string | null, b: string | null) => `${a ?? 'TBD'} vs ${b ?? 'TBD'}`;

const clipKind: ShareKind = {
  kind: 'clip',
  match: (p) => p.match(/^\/watch\/clip\/(\d{1,12})\/?$/)?.[1] ?? null,
  async meta(key) {
    const clip = await clipView(Number(key));
    if (!clip?.video) return null;
    const tag = KIND_TAG[clip.kind] ?? (clip.clutch ? 'Clutch' : clip.kind.toUpperCase());
    return {
      title: `${clip.playerName} · ${tag}`,
      description: [
        clip.title,
        mapLabel(clip.map),
        versus(clip.match.team1, clip.match.team2),
        clip.match.tournament,
      ]
        .filter(Boolean)
        .join(' · '),
      version: versionOf(clip.id, clip.video, clip.playerName, clip.title),
    };
  },
  async card(key): Promise<CardData | null> {
    const clip = await clipView(Number(key));
    if (!clip?.video) return null;
    const tag = KIND_TAG[clip.kind] ?? (clip.clutch ? 'Clutch' : clip.kind.toUpperCase());
    // The title reads "3 kills · AK-47 · round 14": the pill already says how many.
    const detail = [clip.title.replace(/^\d+ kills? · /i, ''), mapLabel(clip.map)]
      .filter(Boolean)
      .join(' · ');
    return {
      kind: 'clip',
      thumbnail: await clipFrame(clip.id, momentOf(clip)),
      tag,
      detail,
      player: clip.playerName,
      context: [versus(clip.match.team1, clip.match.team2), clip.match.tournament]
        .filter(Boolean)
        .join(' · '),
    };
  },
};

const matchReelKind: ShareKind = {
  kind: 'match-reel',
  match: (p) => {
    const m = p.match(/^\/watch\/match\/([A-Za-z0-9_-]{1,180})\/(\d{1,3})\/?$/);
    return m ? `${m[1]}~${m[2]}` : null;
  },
  async meta(key) {
    const [slug, map] = key.split('~');
    const reel = await matchReelView(slug, Number(map));
    if (!reel) return null;
    return {
      title: `${versus(reel.match.team1, reel.match.team2)} · Match reel`,
      description: [plays(reel.chapters.length), mapLabel(reel.map), reel.match.tournament]
        .filter(Boolean)
        .join(' · '),
      version: versionOf(reel.video, reel.chapters.length),
    };
  },
  async card(key) {
    const [slug, map] = key.split('~');
    const reel = await matchReelView(slug, Number(map));
    if (!reel) return null;
    return {
      kind: 'reel',
      label: `Match reel · ${plays(reel.chapters.length)}`,
      title: versus(reel.match.team1, reel.match.team2),
      sub: [reel.match.tournament, mapLabel(reel.map)].filter(Boolean).join(' · '),
      thumbnails: await framesOf(reel.chapters),
    };
  },
};

const playerReelKind: ShareKind = {
  kind: 'player-reel',
  match: (p) => {
    const m = p.match(
      /^\/watch\/reel\/([A-Za-z0-9_-]{1,120})\/(\d{1,3})\/([A-Za-z0-9_.:-]{1,64})\/?$/
    );
    return m ? `${m[1]}~${m[2]}~${m[3]}` : null;
  },
  async meta(key) {
    const [slug, map, player] = key.split('~');
    const reel = await playerReelView(slug, Number(map), player);
    if (!reel) return null;
    const chapters = (reel as { chapters?: unknown[] }).chapters ?? [];
    return {
      title: `${reel.playerName} · Highlights`,
      description: [plays(chapters.length), mapLabel((reel as { map?: string | null }).map)]
        .filter(Boolean)
        .join(' · '),
      version: versionOf(
        (reel as { video?: string | null }).video,
        chapters.length,
        reel.playerName
      ),
    };
  },
  async card(key) {
    const [slug, map, player] = key.split('~');
    const reel = await playerReelView(slug, Number(map), player);
    if (!reel) return null;
    const r = reel as {
      chapters?: { highlightId: number }[];
      map?: string | null;
      match?: { team1: string | null; team2: string | null; tournament: string | null };
    };
    return {
      kind: 'reel',
      label: `Highlights · ${plays(r.chapters?.length ?? 0)}`,
      title: reel.playerName,
      sub: [r.match ? versus(r.match.team1, r.match.team2) : null, mapLabel(r.map)]
        .filter(Boolean)
        .join(' · '),
      thumbnails: await framesOf(r.chapters),
    };
  },
};

const teamReelKind: ShareKind = {
  kind: 'team-reel',
  match: (p) => {
    const m = p.match(/^\/watch\/team\/([A-Za-z0-9_-]{1,120})\/([A-Za-z0-9_-]{1,64})\/?$/);
    return m ? `${m[1]}~${m[2]}` : null;
  },
  async meta(key) {
    const [slug, team] = key.split('~');
    const reel = await teamReelView(slug, team);
    if (!reel) return null;
    const r = reel as { team?: string | null; chapters?: unknown[]; video?: string | null };
    return {
      title: `${r.team ?? 'Team'} · Team reel`,
      description: plays(r.chapters?.length ?? 0),
      version: versionOf(r.video, r.chapters?.length ?? 0),
    };
  },
  async card(key) {
    const [slug, team] = key.split('~');
    const reel = await teamReelView(slug, team);
    if (!reel) return null;
    const r = reel as {
      team?: string | null;
      chapters?: { highlightId: number }[];
      match?: { team1: string | null; team2: string | null; tournament: string | null };
    };
    return {
      kind: 'reel',
      label: `Team reel · ${plays(r.chapters?.length ?? 0)}`,
      title: r.team ?? 'Team',
      sub: r.match
        ? [versus(r.match.team1, r.match.team2), r.match.tournament].filter(Boolean).join(' · ')
        : '',
      thumbnails: await framesOf(r.chapters),
    };
  },
};

const tournamentReelKind: ShareKind = {
  kind: 'tournament-reel',
  match: (p) => p.match(/^\/watch\/tournament\/(\d{1,9})\/?$/)?.[1] ?? null,
  async meta(key) {
    const reel = await tournamentReel(Number(key));
    if (!reel?.video) return null;
    const t = await db.queryOneAsync<{ name: string }>('SELECT name FROM tournament WHERE id = ?', [
      Number(key),
    ]);
    return {
      title: `${t?.name ?? 'Tournament'} · Tournament reel`,
      description: plays(reel.chapters.length),
      version: versionOf(reel.video, reel.chapters.length),
    };
  },
  async card(key) {
    const reel = await tournamentReel(Number(key));
    if (!reel?.video) return null;
    const t = await db.queryOneAsync<{ name: string }>('SELECT name FROM tournament WHERE id = ?', [
      Number(key),
    ]);
    return {
      kind: 'reel',
      label: `Tournament reel · ${plays(reel.chapters.length)}`,
      title: t?.name ?? 'Tournament',
      sub: 'The best plays',
      thumbnails: await framesOf(reel.chapters),
    };
  },
};

export const cs2ShareCards: ShareKind[] = [
  clipKind,
  matchReelKind,
  playerReelKind,
  teamReelKind,
  tournamentReelKind,
];
