/**
 * Music under reels. The reels themselves carry only the game and the crowd;
 * the player plays a track beside them, and a download can have one mixed in
 * (withMusic), or none for YouTube and the like.
 *
 * `highlights_music`: empty (every track), `off`, or the track ids the admin
 * picked, comma separated. Tracks download from Pixabay the first time they
 * are needed (musicTracks.ts says why) and stay in DATA_DIR/highlights/music.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { settingsService } from '../../../services/settingsService';
import { log } from '../../../utils/logger';
import { HIGHLIGHTS_DIR } from './highlights';
import { MUSIC_TRACKS, type MusicTrack } from './musicTracks';

const MUSIC_DIR = path.join(HIGHLIGHTS_DIR, 'music');
const MIX_DIR = path.join(HIGHLIGHTS_DIR, 'with-music');

/** The same levels the player uses (HighlightPlayer's music). */
export const MUSIC_GAIN = 0.11;
export const MUSIC_INTRO_GAIN = 0.32;
const FADE_IN = 1.5;
const FADE_OUT = 2.5;

/** What `highlights_music` holds, read: every track, none, or the ones picked. */
export function parseMusicSetting(value: string | null): 'all' | 'off' | string[] {
  const v = (value ?? '').trim();
  if (!v || v === 'all') return 'all';
  if (v === 'off') return 'off';
  const known = new Set(MUSIC_TRACKS.map((t) => t.id));
  const ids = v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  return ids.length ? ids : 'off';
}

/** The tracks reels may play, in catalogue order. */
export async function enabledTracks(): Promise<MusicTrack[]> {
  const mode = parseMusicSetting(await settingsService.getSetting('highlights_music'));
  if (mode === 'off') return [];
  if (mode === 'all') return [...MUSIC_TRACKS];
  return MUSIC_TRACKS.filter((t) => mode.includes(t.id));
}

export function trackById(id: string): MusicTrack | undefined {
  return MUSIC_TRACKS.find((t) => t.id === id);
}

const downloading = new Map<string, Promise<string>>();

/** The track's MP3 on disk, downloaded from Pixabay the first time. */
export function trackFile(track: MusicTrack): Promise<string> {
  const file = path.join(MUSIC_DIR, `${track.id}.mp3`);
  if (fs.existsSync(file)) return Promise.resolve(file);
  const pending = downloading.get(track.id);
  if (pending) return pending;
  const job = (async () => {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    const res = await globalThis.fetch(track.audio, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Auto Tournament)', Referer: 'https://pixabay.com/' },
      signal: globalThis.AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Pixabay answered ${res.status} for ${track.title}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 10_000)
      throw new Error(`Pixabay sent ${body.length} bytes for ${track.title}`);
    const tmp = `${file}.part`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
    return file;
  })().finally(() => downloading.delete(track.id));
  downloading.set(track.id, job);
  return job;
}

/** Fetches the enabled tracks in the background, one at a time, so the first play doesn't wait. */
export async function prefetchMusic(): Promise<void> {
  let left = await enabledTracks();
  // Three rounds, a minute apart: the network can be slow to come up after a boot.
  for (let round = 0; round < 3 && left.length; round++) {
    if (round) await new Promise((r) => setTimeout(r, 60_000));
    const failed: typeof left = [];
    for (const track of left) {
      try {
        await trackFile(track);
      } catch (error) {
        failed.push(track);
        if (round === 2)
          log.warn('[HIGHLIGHTS] Could not download a music track', {
            track: track.id,
            error: String(error),
          });
      }
    }
    left = failed;
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))
    );
  });
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
 * The music's ffmpeg filter for a video `seconds` long: faded in and out,
 * louder until `intro` (the reel's intro has no game sound) and down to
 * MUSIC_GAIN as the first clip starts.
 */
export function musicFilter(seconds: number, intro: number): string {
  let gain = `${MUSIC_GAIN}`;
  if (intro > 0) {
    const r = (n: number) => n.toFixed(3);
    gain =
      `'if(lt(t,${r(intro)}),${MUSIC_INTRO_GAIN},` +
      `if(lt(t,${r(intro + 0.8)}),${MUSIC_INTRO_GAIN}+(${MUSIC_GAIN - MUSIC_INTRO_GAIN})*(t-${r(intro)})/0.8,${MUSIC_GAIN}))':eval=frame`;
  }
  return (
    `aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${seconds.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `volume=${gain},afade=t=in:d=${FADE_IN},afade=t=out:st=${Math.max(0, seconds - FADE_OUT).toFixed(3)}:d=${FADE_OUT}`
  );
}

const mixing = new Map<string, Promise<string>>();

/**
 * `video` with `track` mixed under its sound, made once and kept. The picture
 * is copied as it is; only the sound is encoded again.
 */
export function withMusic(video: string, track: MusicTrack, intro: number): Promise<string> {
  const introAt = Math.max(0, Math.min(30, Math.round(intro * 10) / 10));
  const out = path.join(MIX_DIR, `${path.basename(video, '.mp4')}-${track.id}-${introAt}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(video).mtimeMs)
    return Promise.resolve(out);
  const pending = mixing.get(out);
  if (pending) return pending;
  const job = (async () => {
    const [music, info] = await Promise.all([trackFile(track), probe(video)]);
    fs.mkdirSync(MIX_DIR, { recursive: true });
    const tmp = `${out}.part.mp4`;
    const filter = info.audio
      ? `[1:a]${musicFilter(info.seconds, introAt)}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`
      : `[1:a]${musicFilter(info.seconds, introAt)}[a]`;
    await run('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-i',
      video,
      '-stream_loop',
      '-1',
      '-i',
      music,
      '-filter_complex',
      filter,
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
