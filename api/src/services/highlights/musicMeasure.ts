/**
 * Measuring the music library's tracks (highlights/music.ts): loudness above
 * 200 Hz, which evens them out, and their energy (hype, mid, calm), rated
 * against each other the way the website's homepage reel rates its songs.
 */

import { spawn } from 'child_process';

/**
 * What every track is evened out to: loudness (EBU R128 integrated) above
 * 200 Hz, so bass-heavy songs don't come out quieter on headphones and laptop
 * speakers. -13.1 there is about -9.6 over the whole spectrum, the level the
 * reel music was tuned at. Gains stay within ±MAX_GAIN_DB; a limiter keeps
 * the peaks of a raised track.
 */
export const MUSIC_TARGET_LUFS = -13.1;
const MAX_GAIN_DB = 4;

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const zScores = (v: number[]) => {
  const m = mean(v);
  const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2))) || 1;
  return v.map((x) => (x - m) / sd);
};
/** The bottom, middle and top third: 1, 2, 3. */
const thirds = (scores: number[]): (1 | 2 | 3)[] => {
  const ranked = [...scores].sort((a, b) => a - b);
  const lo = ranked[Math.floor(ranked.length / 3)];
  const hi = ranked[Math.floor((2 * ranked.length) / 3)];
  return scores.map((s) => {
    if (s >= hi) return 3;
    return s < lo ? 1 : 2;
  });
};

/**
 * Each measured track's energy, as the website's homepage reel rates its
 * songs (scripts/reel-music-energy.py): how much the spectrum moves (drums,
 * hits), how bright it is and how little its loudness swings, against the
 * other measured tracks. A genre with 10 or more is rated on its own. Fewer
 * than 6 measured tracks get no rating: there is nothing to compare with.
 */
export function rateEnergy(
  tracks: { genre: string; flux: number; centroid: number; lra: number }[]
): (1 | 2 | 3)[] {
  if (tracks.length < 6) return [];
  const flux = zScores(tracks.map((t) => t.flux));
  const bright = zScores(tracks.map((t) => t.centroid));
  const steady = zScores(tracks.map((t) => -t.lra));
  const score = flux.map((f, i) => f + 0.5 * bright[i] + 0.5 * steady[i]);
  const out = thirds(score);
  const byGenre = new Map<string, number[]>();
  tracks.forEach((t, i) => byGenre.set(t.genre, [...(byGenre.get(t.genre) ?? []), i]));
  for (const idx of byGenre.values()) {
    if (idx.length < 10) continue;
    thirds(idx.map((i) => score[i])).forEach((e, k) => (out[idx[k]] = e));
  }
  return out;
}

export type Measured = {
  seconds: number;
  hfLufs: number;
  flux: number;
  centroid: number;
  lra: number;
};

/** What `gainDb` evens a track out by, from its loudness above 200 Hz. */
export function gainFor(hfLufs: number): number {
  const g = Math.round((MUSIC_TARGET_LUFS - hfLufs) * 10) / 10;
  return Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, g));
}

/**
 * An audio file's length, loudness above 200 Hz and energy measures (over 90
 * s from 20 s in, past any intro); null when it is not audio.
 */
export async function measure(file: string): Promise<Measured | null> {
  try {
    const out = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]);
    const seconds = Number(out.trim());
    if (!(seconds > 0)) return null;
    const lufs = (af: string, window: string[] = []) =>
      runStderr('ffmpeg', [
        '-hide_banner',
        '-nostats',
        ...window,
        '-i',
        file,
        '-af',
        af,
        '-f',
        'null',
        '-',
      ]);
    const last = (text: string, re: RegExp) => {
      const m = [...text.matchAll(re)].pop();
      return m ? Number(m[1]) : null;
    };
    const hf = last(await lufs('highpass=f=200:poles=2,ebur128'), /I:\s+(-?[\d.]+) LUFS/g);
    const start = Math.min(20, seconds / 4);
    const window = ['-ss', String(start), '-t', '90'];
    const lra = last(await lufs('ebur128', window), /LRA:\s+([\d.]+) LU/g) ?? 0;
    const spectral = await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      ...window,
      '-i',
      file,
      '-af',
      'aformat=channel_layouts=mono,aresample=22050,aspectralstats=win_size=2048:overlap=0.5:measure=flux+centroid,ametadata=print:file=-',
      '-f',
      'null',
      '-',
    ]);
    const values = (key: string) =>
      [...spectral.matchAll(new RegExp(`\\.${key}=([\\d.eE+-]+)`, 'g'))].map((m) => Number(m[1]));
    const flux = values('flux');
    const centroid = values('centroid');
    return {
      seconds,
      hfLufs: hf ?? MUSIC_TARGET_LUFS,
      flux: flux.length ? mean(flux) : 0,
      centroid: centroid.length ? mean(centroid) : 0,
      lra,
    };
  } catch {
    return null;
  }
}

function runStderr(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

export function run(cmd: string, args: string[]): Promise<string> {
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
