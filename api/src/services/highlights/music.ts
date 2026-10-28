/**
 * Music under reels: the install's own library, for every game's highlights
 * (core since 3.0: CS2 had it first). Admins upload the tracks they
 * have the rights to (bring your own music: Auto Tournament ships none and
 * downloads none; musicSuggestions.ts lists where to find some, and
 * THIRD-PARTY-MEDIA.md why). The reels carry only the game and the crowd.
 *
 * The player never gets a track's file: each reel gets its own mix of it
 * (reelMusic), cut to the reel, evened out to the other tracks' loudness and
 * faded, the sound a download mixes in (withSound) too.
 *
 * `highlights_music`: empty (every track), `off`, or the track ids the admin
 * picked, comma separated.
 */

import fs from 'fs';
import path from 'path';
import { db } from '../../config/database';
import { DATA_DIR } from '../../config/dataDir';
import { settingsService } from '../settingsService';
import type { Untrusted } from '../../utils/untrusted';
import { gainFor, measure, rateEnergy, run } from './musicMeasure';

export { gainFor, MUSIC_TARGET_LUFS, rateEnergy } from './musicMeasure';

/** Where highlight videos are kept (every game's recorder uploads here). */
export const HIGHLIGHTS_DIR = path.join(DATA_DIR, 'highlights');

const MUSIC_DIR = path.join(HIGHLIGHTS_DIR, 'music');
const MIX_DIR = path.join(HIGHLIGHTS_DIR, 'with-music');

/**
 * The music's level under the game: a share of the track at its full
 * (evened-out) loudness. The viewer picks it (1 = the whole track); this is
 * theirs until they do. The intro, with no game sound, keeps its own level.
 */
export const MUSIC_GAIN = 0.5;
export const MUSIC_INTRO_GAIN = 0.32;

/** A viewer's music level from a request: 0 to 1, MUSIC_GAIN when absent or wrong. */
export function musicLevel(value: Untrusted): number {
  const n = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(n)
    ? MUSIC_GAIN
    : Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}
const FADE_IN = 1.5;
const FADE_OUT = 2.5;
/** An upload's limits. */
export const MUSIC_MAX_BYTES = 40 * 1024 * 1024;
const MIN_SECONDS = 20;

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  /** A free label the music menu groups by ("drum-n-bass", "phonk", …); "" for none. */
  genre: string;
  seconds: number;
  /** Added to its level, in dB, so it sounds as loud as the others (measured on upload). */
  gainDb: number;
  /** Registered with YouTube Content ID (the admin says so): an upload with it can get a claim. */
  contentId: boolean;
  /** 3 hype, 2 mid, 1 calm, against the other tracks (its genre's when it has 10 or more); absent until measured. */
  energy?: 1 | 2 | 3;
  /** Where it came from (a page), for credit; "" when not given. */
  source: string;
}

interface TrackRow {
  id: number;
  title: string;
  artist: string | null;
  genre: string | null;
  seconds: number | string | null;
  gain_db: number | string | null;
  flux: number | string | null;
  centroid: number | string | null;
  lra: number | string | null;
  content_id: number | boolean | null;
  source: string | null;
  file: string;
}

const toTrack = (r: TrackRow): MusicTrack => ({
  id: String(r.id),
  title: r.title,
  artist: r.artist ?? '',
  genre: r.genre ?? '',
  seconds: Number(r.seconds) || 0,
  gainDb: Number(r.gain_db) || 0,
  contentId: !!Number(r.content_id),
  source: r.source ?? '',
});

/** Every track in the library, grouped by genre, with its energy once measured. */
export async function allTracks(): Promise<MusicTrack[]> {
  const rows = await db.queryAsync<TrackRow>(
    'SELECT * FROM highlight_music_tracks ORDER BY genre, lower(title), id'
  );
  const tracks = rows.map(toTrack);
  const measured = rows.flatMap((r, i) =>
    r.flux == null || r.centroid == null || r.lra == null
      ? []
      : [
          {
            i,
            genre: r.genre ?? '',
            flux: Number(r.flux),
            centroid: Number(r.centroid),
            lra: Number(r.lra),
          },
        ]
  );
  rateEnergy(measured).forEach((e, k) => (tracks[measured[k].i].energy = e));
  return tracks;
}

/** What `highlights_music` holds, read: every track, none, or the ones picked that exist. */
export function parseMusicSetting(
  value: string | null,
  known: Set<string>
): 'all' | 'off' | string[] {
  const v = (value ?? '').trim();
  if (!v || v === 'all') return 'all';
  if (v === 'off') return 'off';
  const ids = v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  return ids.length ? ids : 'off';
}

/** The tracks reels may play. */
export async function enabledTracks(): Promise<MusicTrack[]> {
  const all = await allTracks();
  const mode = parseMusicSetting(
    await settingsService.getSetting('highlights_music'),
    new Set(all.map((t) => t.id))
  );
  if (mode === 'off') return [];
  if (mode === 'all') return all;
  return all.filter((t) => mode.includes(t.id));
}

export async function trackById(id: string): Promise<(MusicTrack & { file: string }) | undefined> {
  if (!/^\d{1,9}$/.test(id)) return undefined;
  const row = await db.queryOneAsync<TrackRow>(
    'SELECT * FROM highlight_music_tracks WHERE id = ?',
    [Number(id)]
  );
  return row ? { ...toTrack(row), file: path.join(MUSIC_DIR, row.file) } : undefined;
}

/** A track's audio on disk. */
export function trackFile(track: { file: string }): string {
  return track.file;
}

/** Mixes made with track `id` (reels, downloads): stale once its level changes. */
function dropMixes(id: string): void {
  for (const f of fs.existsSync(MIX_DIR) ? fs.readdirSync(MIX_DIR) : []) {
    if (f.includes(`-m${id}-`)) fs.rmSync(path.join(MIX_DIR, f), { force: true });
  }
}

/**
 * Measures the tracks added before loudness above 200 Hz and energy were
 * measured (once: they keep their numbers after), and re-levels them.
 */
export async function measureOldTracks(): Promise<number> {
  const rows = await db.queryAsync<{ id: number; file: string }>(
    'SELECT id, file FROM highlight_music_tracks WHERE flux IS NULL ORDER BY id'
  );
  let done = 0;
  for (const r of rows) {
    const m = await measure(path.join(MUSIC_DIR, r.file));
    if (!m) continue;
    await db.runAsync(
      'UPDATE highlight_music_tracks SET gain_db = ?, hf_lufs = ?, flux = ?, centroid = ?, lra = ? WHERE id = ?',
      [gainFor(m.hfLufs), m.hfLufs, m.flux, m.centroid, m.lra, r.id]
    );
    dropMixes(String(r.id));
    done++;
  }
  return done;
}

export class MusicUploadError extends Error {}

/**
 * Removes what 3.0.0-beta.59 downloaded from Pixabay by itself (`<pixabay
 * id>.mp3` in the music folder, and its mixes): the library holds only what
 * an admin uploads now. Uploads are `upload-…`, so nothing of theirs matches.
 */
export function removeDownloadedCatalogue(): number {
  let removed = 0;
  for (const dir of [MUSIC_DIR, MIX_DIR]) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const old = dir === MUSIC_DIR ? /^\d+\.mp3$/.test(f) : /-\d{5,}-[\d.]+\.mp4$/.test(f);
      if (old) {
        fs.rmSync(path.join(dir, f), { force: true });
        removed++;
      }
    }
  }
  return removed;
}

/** Adds an uploaded track to the library: kept as it came, measured, evened out on play. */
export async function addTrack(
  body: Buffer,
  meta: { title: string; artist: string; genre: string; source: string; contentId: boolean }
): Promise<MusicTrack> {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const name = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(MUSIC_DIR, name);
  fs.writeFileSync(file, body);
  const m = await measure(file);
  if (!m) {
    fs.rmSync(file, { force: true });
    throw new MusicUploadError('That is not an audio file ffmpeg can read.');
  }
  if (m.seconds < MIN_SECONDS) {
    fs.rmSync(file, { force: true });
    throw new MusicUploadError(`A track has to be at least ${MIN_SECONDS} seconds long.`);
  }
  const row = await db.queryOneAsync<TrackRow>(
    `INSERT INTO highlight_music_tracks (title, artist, genre, source, content_id, file, seconds, gain_db, hf_lufs, flux, centroid, lra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      meta.title.slice(0, 120),
      meta.artist.slice(0, 120),
      meta.genre.slice(0, 40),
      meta.source.slice(0, 500),
      meta.contentId ? 1 : 0,
      name,
      Math.round(m.seconds),
      gainFor(m.hfLufs),
      m.hfLufs,
      m.flux,
      m.centroid,
      m.lra,
    ]
  );
  return (await allTracks()).find((t) => t.id === String(row!.id)) ?? toTrack(row!);
}

/**
 * Downloads the audio file at `url` for addTrack: a direct link to the file
 * (for Pixabay, the link behind a track's Download button; its pages refuse
 * servers). The admin asks for it, for music they have the rights to.
 */
export async function fetchTrack(url: string): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new MusicUploadError('That is not a link.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new MusicUploadError('That is not a web link.');
  if (/(^|\.)pixabay\.com$/.test(u.hostname) && !/^cdn\./.test(u.hostname))
    throw new MusicUploadError(
      "Pixabay doesn't let servers read its pages: use the link behind the track's Download button (cdn.pixabay.com/…mp3), or download it and choose the file."
    );
  const res = await globalThis.fetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Auto Tournament)',
      ...(/pixabay\.com$/.test(u.hostname) ? { Referer: 'https://pixabay.com/' } : {}),
    },
    redirect: 'follow',
    signal: globalThis.AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new MusicUploadError(`The link answered ${res.status}.`);
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MUSIC_MAX_BYTES) throw new MusicUploadError('That file is too large (40 MB at most).');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MUSIC_MAX_BYTES)
    throw new MusicUploadError('That file is too large (40 MB at most).');
  return body;
}

/** Changes a track's title, artist, genre, source or Content ID mark. */
export async function updateTrack(
  id: string,
  fields: Partial<{
    title: string;
    artist: string;
    genre: string;
    source: string;
    contentId: boolean;
  }>
): Promise<MusicTrack | null> {
  const t = await trackById(id);
  if (!t) return null;
  await db.runAsync(
    'UPDATE highlight_music_tracks SET title = ?, artist = ?, genre = ?, source = ?, content_id = ? WHERE id = ?',
    [
      (fields.title ?? t.title).slice(0, 120),
      (fields.artist ?? t.artist).slice(0, 120),
      (fields.genre ?? t.genre).slice(0, 40),
      (fields.source ?? t.source).slice(0, 500),
      (fields.contentId ?? t.contentId) ? 1 : 0,
      Number(id),
    ]
  );
  return (await trackById(id)) ?? null;
}

/** Removes a track, its file and every mix made with it. */
export async function removeTrack(id: string): Promise<boolean> {
  const t = await trackById(id);
  if (!t) return false;
  await db.runAsync('DELETE FROM highlight_music_tracks WHERE id = ?', [Number(id)]);
  fs.rmSync(t.file, { force: true });
  dropMixes(id);
  return true;
}

/** The video's length in seconds and whether it has sound. */
async function probe(video: string): Promise<{ seconds: number; audio: boolean }> {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type',
    '-of',
    'json',
    video,
  ]);
  const info = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string }[];
  };
  return {
    seconds: Number(info.format?.duration) || 0,
    audio: (info.streams ?? []).some((s) => s.codec_type === 'audio'),
  };
}

/**
 * The music's ffmpeg filter for a video `seconds` long: evened out to the
 * other tracks' loudness by `gainDb`, faded in and out,
 * louder until `intro` (the reel's intro has no game sound) and down to
 * MUSIC_GAIN as the first clip starts.
 */
export function musicFilter(
  seconds: number,
  intro: number,
  gainDb = 0,
  level = MUSIC_GAIN
): string {
  // `level`: the viewer's music level under the game; the intro keeps its own.
  const g = +level.toFixed(4);
  const gi = MUSIC_INTRO_GAIN;
  let gain = `${g}`;
  if (intro > 0) {
    const r = (n: number) => n.toFixed(3);
    gain =
      `'if(lt(t,${r(intro)}),${gi},` +
      `if(lt(t,${r(intro + 0.8)}),${gi}+(${+(g - gi).toFixed(4)})*(t-${r(intro)})/0.8,${g}))':eval=frame`;
  }
  return (
    `aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${seconds.toFixed(3)},asetpts=PTS-STARTPTS,` +
    // The track's own loudness evened out first (MusicTrack.gainDb), then the reel's level.
    // A raised track gets a limiter at -1 dBFS, no auto level, so its peaks don't clip.
    `${gainDb ? `volume=${gainDb.toFixed(1)}dB,` : ''}${gainDb > 0 ? 'alimiter=limit=0.891:level=0,' : ''}volume=${gain},afade=t=in:d=${FADE_IN},afade=t=out:st=${Math.max(0, seconds - FADE_OUT).toFixed(3)}:d=${FADE_OUT}`
  );
}

const mixing = new Map<string, Promise<string>>();

/**
 * `video` with what was asked mixed under its own sound: its crowd track
 * (`crowd`, a file) and/or a music `track`. Made once and kept; the picture
 * is copied as it is and only the sound encoded again.
 */
export function withSound(
  video: string,
  opts: {
    track?: (MusicTrack & { file: string }) | null;
    crowd?: string | null;
    intro: number;
    /** The viewer's music level under the game (musicLevel), 0 to 1. */
    level?: number;
  }
): Promise<string> {
  const introAt = Math.max(0, Math.min(30, Math.round(opts.intro * 10) / 10));
  const level = musicLevel(opts.level);
  const parts = [
    path.basename(video, '.mp4'),
    opts.crowd ? 'crowd' : null,
    opts.track ? `m${opts.track.id}-${introAt}-l${Math.round(level * 100)}` : null,
  ];
  const out = path.join(MIX_DIR, `${parts.filter(Boolean).join('-')}.mp4`);
  const newest = Math.max(
    fs.statSync(video).mtimeMs,
    opts.crowd ? fs.statSync(opts.crowd).mtimeMs : 0
  );
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= newest) return Promise.resolve(out);
  const pending = mixing.get(out);
  if (pending) return pending;
  const job = (async () => {
    const [music, info] = await Promise.all([
      opts.track ? Promise.resolve(trackFile(opts.track)) : null,
      probe(video),
    ]);
    fs.mkdirSync(MIX_DIR, { recursive: true });
    const tmp = `${out}.part.mp4`;
    const args = ['-y', '-v', 'error', '-i', video];
    const filters: string[] = [];
    const mix: string[] = info.audio ? ['[0:a]'] : [];
    if (opts.crowd) {
      args.push('-i', opts.crowd);
      filters.push(
        `[${args.filter((a) => a === '-i').length - 1}:a]aresample=48000,aformat=channel_layouts=stereo[c]`
      );
      mix.push('[c]');
    }
    if (music && opts.track) {
      args.push('-stream_loop', '-1', '-i', music);
      filters.push(
        `[${args.filter((a) => a === '-i').length - 1}:a]${musicFilter(info.seconds, introAt, opts.track.gainDb, level)}[m]`
      );
      mix.push('[m]');
    }
    filters.push(
      mix.length > 1
        ? `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[a]`
        : `${mix[0] ?? 'anullsrc'}anull[a]`
    );
    await run('ffmpeg', [
      ...args,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      info.seconds.toFixed(3),
      '-movflags',
      '+faststart',
      tmp,
    ]);
    fs.renameSync(tmp, out);
    return out;
  })().finally(() => mixing.delete(out));
  mixing.set(out, job);
  return job;
}

/**
 * A reel's own mix of a track (AAC, as long as the reel): the music cut to
 * it, evened out, louder under its intro and faded, exactly what a download
 * mixes in. The player plays this beside the reel, never the track's file.
 * Made once per reel, track and intro, then kept.
 */
export function reelMusic(
  video: string,
  track: MusicTrack & { file: string },
  intro: number
): Promise<string> {
  const introAt = Math.max(0, Math.min(30, Math.round(intro * 10) / 10));
  // The whole track (evened out, faded): the player sets the level each
  // moment, the intro's and the viewer's (an audio element plays at most as
  // loud as its file).
  const out = path.join(
    MIX_DIR,
    `${path.basename(video, '.mp4')}-m${track.id}-${introAt}-full.m4a`
  );
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(video).mtimeMs)
    return Promise.resolve(out);
  const pending = mixing.get(out);
  if (pending) return pending;
  const job = (async () => {
    const info = await probe(video);
    fs.mkdirSync(MIX_DIR, { recursive: true });
    const tmp = `${out}.part.m4a`;
    await run('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-stream_loop',
      '-1',
      '-i',
      trackFile(track),
      '-af',
      musicFilter(info.seconds, 0, track.gainDb, 1),
      '-t',
      info.seconds.toFixed(3),
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      tmp,
    ]);
    fs.renameSync(tmp, out);
    return out;
  })().finally(() => mixing.delete(out));
  mixing.set(out, job);
  return job;
}
